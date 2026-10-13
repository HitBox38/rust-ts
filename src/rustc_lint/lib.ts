//! Lints, aka compiler warnings.
//!
//! A 'lint' check is a kind of miscellaneous constraint that a user _might_
//! want to enforce, but might reasonably want to permit as well, on a
//! module-by-module basis. They contrast with static constraints enforced by
//! other phases of the compiler, which are generally required to hold in order
//! to compile the program at all.
//!
//! Most lints can be written as [`LintPass`] instances. These run after
//! all other analyses. The `LintPass`es built into rustc are defined
//! within [rustc_lint_defs::builtin],
//! which has further comments on how to add such a lint.
//! rustc can also load external lint plugins, as is done for Clippy.
//!
//! See <https://rustc-dev-guide.rust-lang.org/diagnostics.html> for an
//! overview of how lints are implemented.
//!
//! ## Note
//!
//! This API is completely unstable and subject to change.
//
// Port of compiler/rustc_lint/src/lib.rs.
//
// PORT: the `early_lint_methods!(declare_combined_early_lint_pass, [..])` / `late_lint_methods!(
// declare_combined_late_lint_pass, [..])` invocations call the passes.ts functions with `[type, constructor]`
// entries in upstream order (field and `lint_vec` order). Modules that are stubs (every individual pass) are
// listed in docs/handoff/lint-early-a.md.
import { LintId, type LintVec } from "../rustc_lint_defs/lib.ts";
import { builtin as lint_defs_builtin } from "../rustc_lint_defs/lib.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import "../rustc_middle/lint.ts";
import type { LocalModId } from "../rustc_span/def_id.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { AsyncClosureUsage } from "./async_closures.ts";
import { AsyncFnInTrait } from "./async_fn_in_trait.ts";
import { ImplicitAutorefs } from "./autorefs.ts";
import * as builtin from "./builtin.ts";
import { CVoidReturns } from "./c_void_returns.ts";
import { LintStore } from "./context.ts";
import { DanglingPointers } from "./dangling.ts";
import { DefaultCouldBeDerived } from "./default_could_be_derived.ts";
import { DerefIntoDynSupertrait } from "./deref_into_dyn_supertrait.ts";
import { DisallowedPassByRef } from "./disallowed_pass_by_ref.ts";
import { DropForgetUseless } from "./drop_forget_useless.ts";
import { set_builtin_combined_passes } from "./early.ts";
import { EnumIntrinsicsNonEnums } from "./enum_intrinsics_non_enums.ts";
import * as expect from "./expect.ts";
import { ForLoopsOverFallibles } from "./for_loops_over_fallibles.ts";
import * as foreign_modules from "./foreign_modules.ts";
import { FunctionCastsAsInteger } from "./function_cast_as_integer.ts";
import { ImproperGpuKernelLint } from "./gpukernel_abi.ts";
import { IfLetRescope } from "./if_let_rescope.ts";
import { ImplTraitOvercaptures } from "./impl_trait_overcaptures.ts";
import { ImplicitProvenanceCasts } from "./implicit_provenance_casts.ts";
import { InteriorMutableConsts } from "./interior_mutable_consts.ts";
import * as internal from "./internal.ts";
import { InvalidFromUtf8 } from "./invalid_from_utf8.ts";
import { late_lint_mod } from "./late.ts";
import { LetUnderscore } from "./let_underscore.ts";
import * as levels from "./levels.ts";
import { LifetimeSyntax } from "./lifetime_syntax.ts";
import { Expr2024 } from "./macro_expr_fragment_specifier_2024_migration.ts";
import { MapUnitFn } from "./map_unit_fn.ts";
import { MultipleSupertraitUpcastable } from "./multiple_supertrait_upcastable.ts";
import { NonAsciiIdents } from "./non_ascii_idents.ts";
import { NonPanicFmt } from "./non_fmt_panic.ts";
import { NonLocalDefinitions } from "./non_local_def.ts";
import { NonCamelCaseTypes, NonSnakeCase, NonUpperCaseGlobals } from "./nonstandard_style.ts";
import { NoopMethodCall } from "./noop_method_call.ts";
import { OpaqueHiddenInferredBound } from "./opaque_hidden_inferred_bound.ts";
import { declare_combined_early_lint_pass, declare_combined_late_lint_pass, type EarlyLintPass, type LateLintPass } from "./passes.ts";
import { Precedence } from "./precedence.ts";
import { PtrNullChecks } from "./ptr_nulls.ts";
import { RawBorrowsViaReferences } from "./raw_borrows_via_references.ts";
import { RedundantSemicolons } from "./redundant_semicolon.ts";
import { InvalidReferenceCasting } from "./reference_casting.ts";
import { RuntimeSymbols } from "./runtime_symbols.ts";
import { ShadowedIntoIter } from "./shadowed_into_iter.ts";
import { StaticMutRefs } from "./static_mut_refs.ts";
import { DropTraitConstraints } from "./traits.ts";
import { CheckTransmutes } from "./transmute.ts";
import { InvalidAtomicOrdering, TypeLimits, VariantSizeDifferences } from "./types.ts";
import { ImproperCTypesLint } from "./types/improper_ctypes.ts";
import { UnitBindings } from "./unit_bindings.ts";
import { UnqualifiedLocalImports } from "./unqualified_local_imports.ts";
import { UnusedResults } from "./unused/must_use.ts";
import type { Lint as Lint_ } from "../rustc_lint_defs/lib.ts";
import {
  BARE_TRAIT_OBJECTS,
  DEAD_CODE,
  DEPRECATED_SAFE_2024,
  ELIDED_LIFETIMES_IN_PATHS,
  EXPLICIT_OUTLIVES_REQUIREMENTS,
  MALFORMED_DIAGNOSTIC_ATTRIBUTES,
  MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
  MISPLACED_DIAGNOSTIC_ATTRIBUTES,
  REFINING_IMPL_TRAIT_INTERNAL,
  REFINING_IMPL_TRAIT_REACHABLE,
  REPEATED_REPRS,
  UNKNOWN_DIAGNOSTIC_ATTRIBUTES,
  UNREACHABLE_CFG_SELECT_PREDICATES,
  UNREACHABLE_CODE,
  UNREACHABLE_PATTERNS,
  UNUSED_ASSIGNMENTS,
  UNUSED_ATTRIBUTES,
  UNUSED_DOC_COMMENTS,
  UNUSED_EXTERN_CRATES,
  UNUSED_FEATURES,
  UNUSED_IMPORTS,
  UNUSED_LABELS,
  UNUSED_MACRO_RULES,
  UNUSED_MACROS,
  UNUSED_MUT,
  UNUSED_UNSAFE,
  UNUSED_VARIABLES,
  UNUSED_VISIBILITIES,
} from "../rustc_lint_defs/builtin.ts";
import { ELLIPSIS_INCLUSIVE_RANGE_PATTERNS, KEYWORD_IDENTS_2018, KEYWORD_IDENTS_2024 } from "./builtin.ts";
import { DISALLOWED_PASS_BY_REF } from "./disallowed_pass_by_ref.ts";
import {
  BAD_OPT_ACCESS,
  BAD_USE_OF_FIND_ATTR,
  DEFAULT_HASH_TYPES,
  DIRECT_USE_OF_RUSTC_TYPE_IR,
  IMPLICIT_SYSROOT_CRATE_IMPORT,
  LINT_PASS_IMPL_WITHOUT_MACRO,
  NON_GLOB_IMPORT_OF_TYPE_IR_INHERENT,
  POTENTIAL_QUERY_INSTABILITY,
  RUSTC_MUST_MATCH_EXHAUSTIVELY,
  SPAN_USE_EQ_CTXT,
  UNTRACKED_QUERY_INFORMATION,
  USAGE_OF_QUALIFIED_TY,
  USAGE_OF_TY_TYKIND,
  USAGE_OF_TYPE_IR_INHERENT,
  USAGE_OF_TYPE_IR_TRAITS,
} from "./internal.ts";
import { LET_UNDERSCORE_DROP, LET_UNDERSCORE_LOCK } from "./let_underscore.ts";
import { MAP_UNIT_FN } from "./map_unit_fn.ts";
import { NON_CAMEL_CASE_TYPES, NON_SNAKE_CASE, NON_UPPER_CASE_GLOBALS } from "./nonstandard_style.ts";
import { REDUNDANT_SEMICOLONS } from "./redundant_semicolon.ts";
import { UNUSED_MUST_USE } from "./unused/must_use.ts";
import { PATH_STATEMENTS, UNUSED_ALLOCATION, UNUSED_BRACES, UNUSED_PARENS } from "./unused.ts";
import { PathStatements, UnusedAllocation, UnusedBraces, UnusedImportBraces, UnusedParens } from "./unused.ts";

export * as builtin from "./builtin.ts";
export * as lifetime_syntax from "./lifetime_syntax.ts";
export * as unused from "./unused.ts";

export { ARRAY_INTO_ITER, BOXED_SLICE_INTO_ITER } from "./shadowed_into_iter.ts";

export { MissingDoc } from "./builtin.ts";
export { type CheckLintNameResult, EarlyContext, LateContext, type LintContext, LintStore } from "./context.ts";
export type { DiagAndSess } from "./early/diagnostics.ts";
export { EarlyCheckNode, check_ast_node } from "./early.ts";
export { check_crate, late_lint_mod, unerased_lint_store } from "./late.ts";
export { LintLevelsBuilder } from "./levels.ts";
export type { EarlyLintPass, LateLintPass } from "./passes.ts";
export type { BufferedEarlyLint } from "../rustc_errors/lib.ts";
export { Level, Allow, Expect, Warn, ForceWarn, Deny, Forbid } from "../rustc_lint_defs/lib.ts";
export {
  Applicability,
  FutureIncompatibleInfo,
  type Lint,
  LintId,
  type LintPass,
  type LintVec,
  declare_lint_pass,
  impl_lint_pass,
} from "../rustc_lint_defs/lib.ts";
export { std_or_core } from "./utils.ts";

// rustc: compiler/rustc_lint/src/lib.rs:153 provide
export function provide(providers: QueryProviders): void {
  levels.provide(providers);
  expect.provide(providers);
  foreign_modules.provide(providers);
  providers.lint_mod = lint_mod;
}

// rustc: compiler/rustc_lint/src/lib.rs:160 lint_mod
function lint_mod(tcx: TyCtxt, mod_id: LocalModId): null {
  late_lint_mod(tcx, mod_id, BuiltinCombinedLateLintModPass.new());
  return null;
}

type E = EarlyLintPass;
type L = LateLintPass;
/** `$pass: $constructor` of a combined pass. */
function p<P>(ty: { lint_vec(): LintVec }, constructor_: () => P): { ty: { lint_vec(): LintVec }; constructor_: () => P } {
  return { ty, constructor_ };
}

export const BuiltinCombinedPreExpansionLintPass = declare_combined_early_lint_pass("BuiltinCombinedPreExpansionLintPass", {
  // tidy-alphabetical-start
  KeywordIdents: p<E>(builtin.KeywordIdents, () => new builtin.KeywordIdents()),
  // tidy-alphabetical-end
});

export const BuiltinCombinedEarlyLintPass = declare_combined_early_lint_pass("BuiltinCombinedEarlyLintPass", {
  // tidy-alphabetical-start
  AnonymousParameters: p<E>(builtin.AnonymousParameters, () => new builtin.AnonymousParameters()),
  DoubleNegations: p<E>(builtin.DoubleNegations, () => new builtin.DoubleNegations()),
  EllipsisInclusiveRangePatterns: p<E>(builtin.EllipsisInclusiveRangePatterns, () => builtin.EllipsisInclusiveRangePatterns.default()),
  Expr2024: p<E>(Expr2024, () => new Expr2024()),
  IncompleteInternalFeatures: p<E>(builtin.IncompleteInternalFeatures, () => new builtin.IncompleteInternalFeatures()),
  NonAsciiIdents: p<E>(NonAsciiIdents, () => new NonAsciiIdents()),
  NonCamelCaseTypes: p<E>(NonCamelCaseTypes, () => new NonCamelCaseTypes()),
  Precedence: p<E>(Precedence, () => new Precedence()),
  RedundantSemicolons: p<E>(RedundantSemicolons, () => new RedundantSemicolons()),
  SpecialModuleName: p<E>(builtin.SpecialModuleName, () => new builtin.SpecialModuleName()),
  UnsafeCode: p<E>(builtin.UnsafeCode, () => new builtin.UnsafeCode()),
  UnusedBraces: p<E>(UnusedBraces, () => new UnusedBraces()),
  UnusedDocComment: p<E>(lint_defs_builtin.UnusedDocComment, () => new lint_defs_builtin.UnusedDocComment()),
  UnusedImportBraces: p<E>(UnusedImportBraces, () => new UnusedImportBraces()),
  UnusedParens: p<E>(UnusedParens, () => UnusedParens.default()),
  WhileTrue: p<E>(builtin.WhileTrue, () => new builtin.WhileTrue()),
  // tidy-alphabetical-end
});

const InternalCombinedEarlyLintPass = declare_combined_early_lint_pass("InternalCombinedEarlyLintPass", {
  // tidy-alphabetical-start
  BadUseOfFindAttr: p<E>(internal.BadUseOfFindAttr, () => new internal.BadUseOfFindAttr()),
  ImplicitSysrootCrateImport: p<E>(internal.ImplicitSysrootCrateImport, () => new internal.ImplicitSysrootCrateImport()),
  LintPassImpl: p<E>(internal.LintPassImpl, () => new internal.LintPassImpl()),
  // tidy-alphabetical-end
});

const BuiltinCombinedLateLintModPass = declare_combined_late_lint_pass("BuiltinCombinedLateLintModPass", {
  // tidy-alphabetical-start
  AsmLabels: p<L>(builtin.AsmLabels, () => new builtin.AsmLabels()),
  AsyncClosureUsage: p<L>(AsyncClosureUsage, () => new AsyncClosureUsage()),
  AsyncFnInTrait: p<L>(AsyncFnInTrait, () => new AsyncFnInTrait()),
  CVoidReturns: p<L>(CVoidReturns, () => new CVoidReturns()),
  CheckTransmutes: p<L>(CheckTransmutes, () => new CheckTransmutes()),
  DanglingPointers: p<L>(DanglingPointers, () => new DanglingPointers()),
  DefaultCouldBeDerived: p<L>(DefaultCouldBeDerived, () => new DefaultCouldBeDerived()),
  DerefIntoDynSupertrait: p<L>(DerefIntoDynSupertrait, () => new DerefIntoDynSupertrait()),
  DerefNullPtr: p<L>(builtin.DerefNullPtr, () => new builtin.DerefNullPtr()),
  DropForgetUseless: p<L>(DropForgetUseless, () => new DropForgetUseless()),
  DropTraitConstraints: p<L>(DropTraitConstraints, () => new DropTraitConstraints()),
  EnumIntrinsicsNonEnums: p<L>(EnumIntrinsicsNonEnums, () => new EnumIntrinsicsNonEnums()),
  ExplicitOutlivesRequirements: p<L>(builtin.ExplicitOutlivesRequirements, () => new builtin.ExplicitOutlivesRequirements()),
  ForLoopsOverFallibles: p<L>(ForLoopsOverFallibles, () => new ForLoopsOverFallibles()),
  FunctionCastsAsInteger: p<L>(FunctionCastsAsInteger, () => new FunctionCastsAsInteger()),
  IfLetRescope: p<L>(IfLetRescope, () => IfLetRescope.default()),
  ImplTraitOvercaptures: p<L>(ImplTraitOvercaptures, () => new ImplTraitOvercaptures()),
  ImplicitAutorefs: p<L>(ImplicitAutorefs, () => new ImplicitAutorefs()),
  ImplicitProvenanceCasts: p<L>(ImplicitProvenanceCasts, () => new ImplicitProvenanceCasts()),
  ImproperCTypesLint: p<L>(ImproperCTypesLint, () => ImproperCTypesLint.default()),
  ImproperGpuKernelLint: p<L>(ImproperGpuKernelLint, () => new ImproperGpuKernelLint()),
  InteriorMutableConsts: p<L>(InteriorMutableConsts, () => new InteriorMutableConsts()),
  InternalEqTraitMethodImpls: p<L>(builtin.InternalEqTraitMethodImpls, () => new builtin.InternalEqTraitMethodImpls()),
  InvalidAtomicOrdering: p<L>(InvalidAtomicOrdering, () => new InvalidAtomicOrdering()),
  InvalidFromUtf8: p<L>(InvalidFromUtf8, () => new InvalidFromUtf8()),
  InvalidNoMangleItems: p<L>(builtin.InvalidNoMangleItems, () => new builtin.InvalidNoMangleItems()),
  InvalidReferenceCasting: p<L>(InvalidReferenceCasting, () => new InvalidReferenceCasting()),
  InvalidValue: p<L>(builtin.InvalidValue, () => new builtin.InvalidValue()),
  LetUnderscore: p<L>(LetUnderscore, () => new LetUnderscore()),
  LifetimeSyntax: p<L>(LifetimeSyntax, () => new LifetimeSyntax()),
  MapUnitFn: p<L>(MapUnitFn, () => new MapUnitFn()),
  // Depends on types used in type definitions
  MissingCopyImplementations: p<L>(builtin.MissingCopyImplementations, () => new builtin.MissingCopyImplementations()),
  MissingDebugImplementations: p<L>(builtin.MissingDebugImplementations, () => new builtin.MissingDebugImplementations()),
  MissingDoc: p<L>(builtin.MissingDoc, () => new builtin.MissingDoc()),
  MultipleSupertraitUpcastable: p<L>(MultipleSupertraitUpcastable, () => new MultipleSupertraitUpcastable()),
  MutableTransmutes: p<L>(builtin.MutableTransmutes, () => new builtin.MutableTransmutes()),
  NonLocalDefinitions: p<L>(NonLocalDefinitions, () => NonLocalDefinitions.default()),
  NonPanicFmt: p<L>(NonPanicFmt, () => new NonPanicFmt()),
  NonShorthandFieldPatterns: p<L>(builtin.NonShorthandFieldPatterns, () => new builtin.NonShorthandFieldPatterns()),
  NonSnakeCase: p<L>(NonSnakeCase, () => new NonSnakeCase()),
  NonUpperCaseGlobals: p<L>(NonUpperCaseGlobals, () => new NonUpperCaseGlobals()),
  NoopMethodCall: p<L>(NoopMethodCall, () => new NoopMethodCall()),
  OpaqueHiddenInferredBound: p<L>(OpaqueHiddenInferredBound, () => new OpaqueHiddenInferredBound()),
  PathStatements: p<L>(PathStatements, () => new PathStatements()),
  // Depends on referenced function signatures in expressions
  PtrNullChecks: p<L>(PtrNullChecks, () => new PtrNullChecks()),
  RawBorrowsViaReferences: p<L>(RawBorrowsViaReferences, () => new RawBorrowsViaReferences()),
  RuntimeSymbols: p<L>(RuntimeSymbols, () => new RuntimeSymbols()),
  ShadowedIntoIter: p<L>(ShadowedIntoIter, () => new ShadowedIntoIter()),
  StaticMutRefs: p<L>(StaticMutRefs, () => new StaticMutRefs()),
  TrivialConstraints: p<L>(builtin.TrivialConstraints, () => new builtin.TrivialConstraints()),
  TypeAliasBounds: p<L>(builtin.TypeAliasBounds, () => new builtin.TypeAliasBounds()),
  TypeLimits: p<L>(TypeLimits, () => TypeLimits.new()),
  UngatedAsyncFnTrackCaller: p<L>(builtin.UngatedAsyncFnTrackCaller, () => new builtin.UngatedAsyncFnTrackCaller()),
  UnitBindings: p<L>(UnitBindings, () => new UnitBindings()),
  UnqualifiedLocalImports: p<L>(UnqualifiedLocalImports, () => new UnqualifiedLocalImports()),
  // Depends on effective visibilities
  UnreachablePub: p<L>(builtin.UnreachablePub, () => new builtin.UnreachablePub()),
  UnstableFeatures: p<L>(builtin.UnstableFeatures, () => new builtin.UnstableFeatures()),
  UnusedAllocation: p<L>(UnusedAllocation, () => new UnusedAllocation()),
  // Depends on referenced function signatures in expressions
  UnusedResults: p<L>(UnusedResults, () => new UnusedResults()),
  VariantSizeDifferences: p<L>(VariantSizeDifferences, () => new VariantSizeDifferences()),
  // tidy-alphabetical-end
});

const InternalCombinedLateLintModPass = declare_combined_late_lint_pass("InternalCombinedLateLintModPass", {
  // tidy-alphabetical-start
  BadOptAccess: p<L>(internal.BadOptAccess, () => new internal.BadOptAccess()),
  DefaultHashTypes: p<L>(internal.DefaultHashTypes, () => new internal.DefaultHashTypes()),
  DisallowedPassByRef: p<L>(DisallowedPassByRef, () => new DisallowedPassByRef()),
  MissingGenericTypeVisitableDerive: p<L>(internal.MissingGenericTypeVisitableDerive, () => new internal.MissingGenericTypeVisitableDerive()),
  QueryStability: p<L>(internal.QueryStability, () => new internal.QueryStability()),
  RustcMustMatchExhaustively: p<L>(internal.RustcMustMatchExhaustively, () => new internal.RustcMustMatchExhaustively()),
  SpanUseEqCtxt: p<L>(internal.SpanUseEqCtxt, () => new internal.SpanUseEqCtxt()),
  SymbolInternStringLiteral: p<L>(internal.SymbolInternStringLiteral, () => new internal.SymbolInternStringLiteral()),
  TyTyKind: p<L>(internal.TyTyKind, () => new internal.TyTyKind()),
  TypeIr: p<L>(internal.TypeIr, () => new internal.TypeIr()),
  // tidy-alphabetical-end
});

set_builtin_combined_passes({ pre_expansion: () => BuiltinCombinedPreExpansionLintPass, early: () => BuiltinCombinedEarlyLintPass });

// rustc: compiler/rustc_lint/src/lib.rs:313 new_lint_store
export function new_lint_store(internal_lints: boolean): LintStore {
  const lint_store = LintStore.new();

  register_builtins(lint_store);
  if (internal_lints) {
    register_internals(lint_store);
  }

  return lint_store;
}

/// Tell the `LintStore` about all the built-in lints (the ones
/// defined in this crate and the ones defined in
/// `rustc_lint_defs::builtin`).
// rustc: compiler/rustc_lint/src/lib.rs:327 register_builtins
function register_builtins(store: LintStore): void {
  // macro_rules! add_lint_group { ($name:expr, $($lint:ident),*) => (store.register_group(false, $name, None, vec![$(LintId::of($lint)),*]);) }
  const add_lint_group = (name: string, ...lints: Lint_[]): void => {
    store.register_group(false, name, undefined, lints.map((lint) => LintId.of(lint)));
  };

  store.register_lints(BuiltinCombinedPreExpansionLintPass.lint_vec());
  store.register_lints(BuiltinCombinedEarlyLintPass.lint_vec());
  store.register_lints(BuiltinCombinedLateLintModPass.lint_vec());
  store.register_lints(foreign_modules.lint_vec());
  store.register_lints(lint_defs_builtin.hardwired.lint_vec());

  add_lint_group("nonstandard_style", NON_CAMEL_CASE_TYPES, NON_SNAKE_CASE, NON_UPPER_CASE_GLOBALS);

  add_lint_group(
    "unused",
    UNUSED_IMPORTS,
    UNUSED_VARIABLES,
    UNUSED_VISIBILITIES,
    UNUSED_ASSIGNMENTS,
    DEAD_CODE,
    UNUSED_MUT,
    UNREACHABLE_CFG_SELECT_PREDICATES,
    UNREACHABLE_CODE,
    UNREACHABLE_PATTERNS,
    UNUSED_MUST_USE,
    UNUSED_UNSAFE,
    PATH_STATEMENTS,
    UNUSED_ATTRIBUTES,
    UNUSED_MACROS,
    UNUSED_MACRO_RULES,
    UNUSED_ALLOCATION,
    UNUSED_DOC_COMMENTS,
    UNUSED_EXTERN_CRATES,
    UNUSED_FEATURES,
    UNUSED_LABELS,
    UNUSED_PARENS,
    UNUSED_BRACES,
    REDUNDANT_SEMICOLONS,
    MAP_UNIT_FN,
    REPEATED_REPRS,
  );

  add_lint_group("let_underscore", LET_UNDERSCORE_DROP, LET_UNDERSCORE_LOCK);

  add_lint_group(
    "rust_2018_idioms",
    BARE_TRAIT_OBJECTS,
    UNUSED_EXTERN_CRATES,
    ELLIPSIS_INCLUSIVE_RANGE_PATTERNS,
    ELIDED_LIFETIMES_IN_PATHS,
    EXPLICIT_OUTLIVES_REQUIREMENTS, // FIXME(#52665, #47816) not always applicable and not all
    // macros are ready for this yet.
    // UNREACHABLE_PUB,

    // FIXME macro crates are not up for this yet, too much
    // breakage is seen if we try to encourage this lint.
    // MACRO_USE_EXTERN_CRATE
  );

  add_lint_group("keyword_idents", KEYWORD_IDENTS_2018, KEYWORD_IDENTS_2024);

  add_lint_group("refining_impl_trait", REFINING_IMPL_TRAIT_REACHABLE, REFINING_IMPL_TRAIT_INTERNAL);

  add_lint_group("deprecated_safe", DEPRECATED_SAFE_2024);

  add_lint_group(
    "unknown_or_malformed_diagnostic_attributes",
    MALFORMED_DIAGNOSTIC_ATTRIBUTES,
    MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
    MISPLACED_DIAGNOSTIC_ATTRIBUTES,
    UNKNOWN_DIAGNOSTIC_ATTRIBUTES,
  );

  // Register renamed and removed lints.
  store.register_renamed("single_use_lifetime", "single_use_lifetimes");
  store.register_renamed("elided_lifetime_in_path", "elided_lifetimes_in_paths");
  store.register_renamed("bare_trait_object", "bare_trait_objects");
  store.register_renamed("unstable_name_collision", "unstable_name_collisions");
  store.register_renamed("unused_doc_comment", "unused_doc_comments");
  store.register_renamed("async_idents", "keyword_idents_2018");
  store.register_renamed("exceeding_bitshifts", "arithmetic_overflow");
  store.register_renamed("redundant_semicolon", "redundant_semicolons");
  store.register_renamed("overlapping_patterns", "overlapping_range_endpoints");
  store.register_renamed("disjoint_capture_migration", "rust_2021_incompatible_closure_captures");
  store.register_renamed("or_patterns_back_compat", "rust_2021_incompatible_or_patterns");
  store.register_renamed("non_fmt_panic", "non_fmt_panics");
  store.register_renamed("unused_tuple_struct_fields", "dead_code");
  store.register_renamed("static_mut_ref", "static_mut_refs");
  store.register_renamed("temporary_cstring_as_ptr", "dangling_pointers_from_temporaries");
  store.register_renamed("elided_named_lifetimes", "mismatched_lifetime_syntaxes");
  store.register_renamed("fuzzy_provenance_casts", "implicit_provenance_casts");
  store.register_renamed("lossy_provenance_casts", "implicit_provenance_casts");
  // These were moved to tool lints, but rustc still sees them when compiling normally, before
  // tool lints are registered, so `check_tool_name_for_backwards_compat` doesn't work. Use
  // `register_removed` explicitly.
  const RUSTDOC_LINTS: readonly string[] = [
    "broken_intra_doc_links",
    "private_intra_doc_links",
    "missing_crate_level_docs",
    "missing_doc_code_examples",
    "private_doc_tests",
    "invalid_codeblock_attributes",
    "invalid_html_tags",
    "non_autolinks",
  ];
  for (const rustdoc_lint of RUSTDOC_LINTS) {
    store.register_ignored(rustdoc_lint);
  }
  store.register_removed("intra_doc_link_resolution_failure", "use `rustdoc::broken_intra_doc_links` instead");
  store.register_removed("rustdoc", "use `rustdoc::all` instead");
  store.register_removed("unknown_features", "replaced by an error");
  store.register_removed("unsigned_negation", "replaced by negate_unsigned feature gate");
  store.register_removed("negate_unsigned", "cast a signed value instead");
  store.register_removed("raw_pointer_derive", "using derive with raw pointers is ok");
  // Register lint group aliases.
  store.register_group_alias("nonstandard_style", "bad_style");
  // This was renamed to `raw_pointer_derive`, which was then removed,
  // so it is also considered removed.
  store.register_removed("raw_pointer_deriving", "using derive with raw pointers is ok");
  store.register_removed("drop_with_repr_extern", "drop flags have been removed");
  store.register_removed("fat_ptr_transmutes", "was accidentally removed back in 2014");
  store.register_removed("deprecated_attr", "use `deprecated` instead");
  store.register_removed("transmute_from_fn_item_types", "always cast functions before transmuting them");
  store.register_removed("hr_lifetime_in_assoc_type", "converted into hard error, see issue #33685 <https://github.com/rust-lang/rust/issues/33685> for more information");
  store.register_removed("inaccessible_extern_crate", "converted into hard error, see issue #36886 <https://github.com/rust-lang/rust/issues/36886> for more information");
  store.register_removed("super_or_self_in_global_path", "converted into hard error, see issue #36888 <https://github.com/rust-lang/rust/issues/36888> for more information");
  store.register_removed("overlapping_inherent_impls", "converted into hard error, see issue #36889 <https://github.com/rust-lang/rust/issues/36889> for more information");
  store.register_removed("illegal_floating_point_constant_pattern", "converted into hard error, see issue #36890 <https://github.com/rust-lang/rust/issues/36890> for more information");
  store.register_removed("illegal_struct_or_enum_constant_pattern", "converted into hard error, see issue #36891 <https://github.com/rust-lang/rust/issues/36891> for more information");
  store.register_removed("lifetime_underscore", "converted into hard error, see issue #36892 <https://github.com/rust-lang/rust/issues/36892> for more information");
  store.register_removed("extra_requirement_in_impl", "converted into hard error, see issue #37166 <https://github.com/rust-lang/rust/issues/37166> for more information");
  store.register_removed("legacy_imports", "converted into hard error, see issue #38260 <https://github.com/rust-lang/rust/issues/38260> for more information");
  store.register_removed("coerce_never", "converted into hard error, see issue #48950 <https://github.com/rust-lang/rust/issues/48950> for more information");
  store.register_removed("resolve_trait_on_defaulted_unit", "converted into hard error, see issue #48950 <https://github.com/rust-lang/rust/issues/48950> for more information");
  store.register_removed("private_no_mangle_fns", "no longer a warning, `#[no_mangle]` functions always exported");
  store.register_removed("private_no_mangle_statics", "no longer a warning, `#[no_mangle]` statics always exported");
  store.register_removed("bad_repr", "replaced with a generic attribute input check");
  store.register_removed("duplicate_matcher_binding_name", "converted into hard error, see issue #57742 <https://github.com/rust-lang/rust/issues/57742> for more information");
  store.register_removed("incoherent_fundamental_impls", "converted into hard error, see issue #46205 <https://github.com/rust-lang/rust/issues/46205> for more information");
  store.register_removed("legacy_constructor_visibility", "converted into hard error, see issue #39207 <https://github.com/rust-lang/rust/issues/39207> for more information");
  store.register_removed("legacy_directory_ownership", "converted into hard error, see issue #37872 <https://github.com/rust-lang/rust/issues/37872> for more information");
  store.register_removed("safe_extern_statics", "converted into hard error, see issue #36247 <https://github.com/rust-lang/rust/issues/36247> for more information");
  store.register_removed("parenthesized_params_in_types_and_modules", "converted into hard error, see issue #42238 <https://github.com/rust-lang/rust/issues/42238> for more information");
  store.register_removed("duplicate_macro_exports", "converted into hard error, see issue #35896 <https://github.com/rust-lang/rust/issues/35896> for more information");
  store.register_removed("nested_impl_trait", "converted into hard error, see issue #59014 <https://github.com/rust-lang/rust/issues/59014> for more information");
  store.register_removed("plugin_as_library", "plugins have been deprecated and retired");
  store.register_removed("unsupported_naked_functions", "converted into hard error, see RFC 2972 <https://rust-lang.github.io/rfcs/2972-constrained-naked.html> for more information");
  store.register_removed("mutable_borrow_reservation_conflict", "now allowed, see issue #59159 <https://github.com/rust-lang/rust/issues/59159> for more information");
  store.register_removed("const_err", "converted into hard error, see issue #71800 <https://github.com/rust-lang/rust/issues/71800> for more information");
  store.register_removed("safe_packed_borrows", "converted into hard error, see issue #82523 <https://github.com/rust-lang/rust/issues/82523> for more information");
  store.register_removed("unaligned_references", "converted into hard error, see issue #82523 <https://github.com/rust-lang/rust/issues/82523> for more information");
  store.register_removed("private_in_public", "replaced with another group of lints, see RFC <https://rust-lang.github.io/rfcs/2145-type-privacy.html> for more information");
  store.register_removed("invalid_alignment", "converted into hard error, see PR #104616 <https://github.com/rust-lang/rust/pull/104616> for more information");
  store.register_removed("implied_bounds_entailment", "converted into hard error, see PR #117984 <https://github.com/rust-lang/rust/pull/117984> for more information");
  store.register_removed("coinductive_overlap_in_coherence", "converted into hard error, see PR #118649 <https://github.com/rust-lang/rust/pull/118649> for more information");
  store.register_removed("illegal_floating_point_literal_pattern", "no longer a warning, float patterns behave the same as `==`");
  store.register_removed("nontrivial_structural_match", "no longer needed, see RFC #3535 <https://rust-lang.github.io/rfcs/3535-constants-in-patterns.html> for more information");
  store.register_removed("suspicious_auto_trait_impls", "no longer needed, see issue #93367 <https://github.com/rust-lang/rust/issues/93367> for more information");
  store.register_removed("const_patterns_without_partial_eq", "converted into hard error, see RFC #3535 <https://rust-lang.github.io/rfcs/3535-constants-in-patterns.html> for more information");
  store.register_removed("indirect_structural_match", "converted into hard error, see RFC #3535 <https://rust-lang.github.io/rfcs/3535-constants-in-patterns.html> for more information");
  store.register_removed("deprecated_cfg_attr_crate_type_name", "converted into hard error, see issue #91632 <https://github.com/rust-lang/rust/issues/91632> for more information");
  store.register_removed("pointer_structural_match", "converted into hard error, see RFC #3535 <https://rust-lang.github.io/rfcs/3535-constants-in-patterns.html> for more information");
  store.register_removed("box_pointers", "it does not detect other kinds of allocations, and existed only for historical reasons");
  store.register_removed("byte_slice_in_packed_struct_with_derive", "converted into hard error, see issue #107457 <https://github.com/rust-lang/rust/issues/107457> for more information");
  store.register_removed("writes_through_immutable_pointer", "converted into hard error");
  store.register_removed("const_eval_mutable_ptr_in_final_value", "partially allowed now, otherwise turned into a hard error");
  store.register_removed("where_clauses_object_safety", "converted into hard error, see PR #125380 <https://github.com/rust-lang/rust/pull/125380> for more information");
  store.register_removed("cenum_impl_drop_cast", "converted into hard error, see <https://github.com/rust-lang/rust/issues/73333> for more information");
  store.register_removed("ptr_cast_add_auto_to_object", "converted into hard error, see issue #127323 <https://github.com/rust-lang/rust/issues/127323> for more information");
  store.register_removed("unsupported_fn_ptr_calling_conventions", "converted into hard error");
  store.register_removed("undefined_naked_function_abi", "converted into hard error, see PR #139001 <https://github.com/rust-lang/rust/issues/139001> for more information");
  store.register_removed("abi_unsupported_vector_types", "converted into hard error, see <https://github.com/rust-lang/rust/issues/116558> for more information");
  store.register_removed("missing_fragment_specifier", "converted into hard error, see <https://github.com/rust-lang/rust/issues/40107> for more information");
  store.register_removed("wasm_c_abi", "the wasm C ABI has been fixed");
  store.register_removed("soft_unstable", "the general soft-unstable mechanism has been removed");
  store.register_removed("inline_always_mismatching_target_features", "replaced by a hard error for `#[inline(always)]` with `#[target_feature]`");
  store.register_removed("repr_transparent_external_private_fields", "converted into hard error, see <https://github.com/rust-lang/rust/issues/78586> for more information");
  store.register_removed("repr_transparent_non_zst_fields", "converted into hard error, see <https://github.com/rust-lang/rust/issues/78586> for more information");
  store.register_removed("no_mangle_generic_items", "converted into hard error, generic items must always be mangled");
  store.register_removed("dependency_on_unit_never_type_fallback", "the code warned by this lint no longer compiles");

}

// rustc: compiler/rustc_lint/src/lib.rs:725 register_internals
function register_internals(store: LintStore): void {
  store.register_lints(InternalCombinedEarlyLintPass.lint_vec());
  store.register_early_lint_pass(() => InternalCombinedEarlyLintPass.new());

  store.register_lints(InternalCombinedLateLintModPass.lint_vec());
  store.register_late_lint_mod_pass((_) => InternalCombinedLateLintModPass.new());

  store.register_group(false, "rustc::internal", undefined, [
    // Early pass: LintPassImpl
    LintId.of(LINT_PASS_IMPL_WITHOUT_MACRO),
    // Early pass: ImplicitSysrootCrateImport
    LintId.of(IMPLICIT_SYSROOT_CRATE_IMPORT),
    // Early pass: BadUseOfFindAttr
    LintId.of(BAD_USE_OF_FIND_ATTR),
    // Late pass: DefaultHashTypes
    LintId.of(DEFAULT_HASH_TYPES),
    // Late pass: QueryStability
    LintId.of(POTENTIAL_QUERY_INSTABILITY),
    LintId.of(UNTRACKED_QUERY_INFORMATION),
    // Late pass: TyTyKind
    LintId.of(USAGE_OF_TY_TYKIND),
    LintId.of(USAGE_OF_QUALIFIED_TY),
    // Late pass: TypeIr
    LintId.of(DIRECT_USE_OF_RUSTC_TYPE_IR),
    LintId.of(NON_GLOB_IMPORT_OF_TYPE_IR_INHERENT),
    LintId.of(USAGE_OF_TYPE_IR_INHERENT),
    LintId.of(USAGE_OF_TYPE_IR_TRAITS),
    // Late pass: BadOptAccess
    LintId.of(BAD_OPT_ACCESS),
    // Late pass: DisallowedPassByRef
    LintId.of(DISALLOWED_PASS_BY_REF),
    // Late pass: SpanUseEqCtxt
    LintId.of(SPAN_USE_EQ_CTXT),
    // Late pass: SymbolInternStringLiteral
    // Note: this one is not included in rustc::internal because rustc_driver crates
    // outside the compiler can't/shouldn't add preinterned symbols. For rustc itself,
    // bootstrap enables this lint manually. For rustdoc,
    // `warn(symbol_intern_string_literal)` is used.
    // LintId::of(SYMBOL_INTERN_STRING_LITERAL),
    //
    // Late pass: RustcMustMatchExhaustively
    LintId.of(RUSTC_MUST_MATCH_EXHAUSTIVELY),
    // Late pass: MissingGenericTypeVisitableDerive
    // Note: this one is not included so that it doesn't become effectively warn-by-default
    // (since `rustc::internal` is warn-by-default). Instead, it's enabled manually in
    // each relevant crate.
    // LintId::of(MISSING_GENERIC_TYPE_VISITABLE_DERIVE),
  ]);
}

/// Is a pass (which contains `lints`) required to run? Maybe not, e.g. for dependencies built with
/// `--cap-lints=allow`.
///
/// Note: this is a conservative estimate intended for optimization purposes. It might return
/// `true` for a pass that need not run, but it will never return `false` for a pass that must run.
// rustc: compiler/rustc_lint/src/lib.rs:787 is_lint_pass_required
export function is_lint_pass_required(skippable: ReadonlySet<LintId>, lints: LintVec): boolean {
  // A pass without any lints? Clippy sometimes does this, to collect things while traversing.
  // Such a pass must always run.
  if (lints.length === 0) {
    return true;
  }

  // Otherwise, the pass must run unless all lints within are skippable.
  return !lints.every((lint) => skippable.has(LintId.of(lint)));
}
