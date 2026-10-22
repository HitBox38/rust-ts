// Port of compiler/rustc_pattern_analysis/src/rustc.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-c's.
//
// ## How to fill a stub (lane pat-c)
// The types (fields in declaration order) and signatures are final; a wrong one goes in your handoff (or fix it and
// say so). Replace the `unported(..)` body in place and turn `// stub: <path>:<line> <name> (lane pat-c)` into
// `// rustc: <path>:<line> <name>`; then lower the counts in src/rustc_pattern_analysis/contract.test.ts.
// Conventions: lib.ts header. Specific to this file:
// - `RevealedTy` is a branded `Ty` (`#[repr(transparent)]` newtype with `Deref<Target = Ty>`): `RevealedTy(ty)` is a
//   cast, `.inner()` / `*ty` are the identity, and `Ty`'s methods apply directly (`ty.kind()`).
// - `RustcPatCtxtTypes` is the `PatCx` types bundle of `RustcPatCtxt` (`type Ty = RevealedTy`, ..). The rustc-specific
//   aliases below (`Constructor`, `DeconstructedPat`, `MatchArm`, ..) instantiate the generic types with it; the
//   generic types' companion values are re-exported under the same names (`Constructor.Wildcard`).
// - The `PatCx` impl's `ctor_arity` / `ctor_sub_tys` / `ctors_for_ty` forward to the inherent methods of the same
//   names: in TS that is the same method (`&Self::Ty` and `RevealedTy` are both `RevealedTy`).
// - The static side of `PatCx` (lib.ts `PatCxStatic`: `write_variant_name` and the associated types' `Debug` /
//   `PartialEq`) is on the prototype, so `RustcPatCtxt.prototype` is the static side where only the type is known.
// - `dropless_arena` (rustc_arena, erased: PORTING §5) is kept as an opaque field; `alloc_from_iter` is the array.
// - Nested fns (`reveal_inner`, `reveal_and_alloc`, `expand`) are module-level fns next to their parent.
import type { VariantIdx } from "../rustc_abi/layout.ts";
import { debug_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import type { Pat, PatRangeBoundary } from "../rustc_middle/thir.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import { debug_Value, type Value } from "../rustc_middle/ty/consts/valtree.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TypeckResults } from "../rustc_middle/ty/decls.ts";
import type { FieldDef, Ty, TypingEnv, VariantDef } from "../rustc_middle/ty/mod.ts";
import type { OpaqueTypeKey } from "../rustc_middle/ty/opaque_types.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { LocalModId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import * as constructor from "./constructor.ts";
import type { IntRange, MaybeInfiniteInt } from "./constructor.ts";
import { type PatCx, PatCx_provided, type PrivateUninhabitedField } from "./lib.ts";
import type * as lib from "./lib.ts";
import { lint_nonexhaustive_missing_variants } from "./lints.ts";
import * as pat from "./pat.ts";
import { PatternColumn } from "./pat_column.ts";
import * as usefulness from "./usefulness.ts";
import { compute_match_usefulness, PlaceValidity } from "./usefulness.ts";
import { type Debug, debug_struct, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";

// mod print;
// PORT: rustc/print.ts is imported by the fns that use it (pat-c).

/** PORT: the associated types of `impl PatCx for RustcPatCtxt` (rustc.rs:891-896) as a types bundle (lib.ts header). */
export interface RustcPatCtxtTypes {
  Ty: RevealedTy;
  Error: ErrorGuaranteed;
  VariantIdx: VariantIdx;
  StrLit: Value;
  ArmData: HirId;
  PatData: Pat;
}

// Re-export rustc-specific versions of all these types.
export type Constructor = constructor.Constructor<RustcPatCtxtTypes>;
export const Constructor = constructor.Constructor;
export type ConstructorSet = constructor.ConstructorSet<RustcPatCtxtTypes>;
export const ConstructorSet = constructor.ConstructorSet;
export type DeconstructedPat = pat.DeconstructedPat<RustcPatCtxtTypes>;
export const DeconstructedPat = pat.DeconstructedPat;
export type MatchArm = lib.MatchArm<RustcPatCtxtTypes>;
export type RedundancyExplanation = usefulness.RedundancyExplanation<RustcPatCtxtTypes>;
export type Usefulness = usefulness.Usefulness<RustcPatCtxtTypes>;
export type UsefulnessReport = usefulness.UsefulnessReport<RustcPatCtxtTypes>;
export type WitnessPat = pat.WitnessPat<RustcPatCtxtTypes>;
export const WitnessPat = pat.WitnessPat;

declare const REVEALED: unique symbol;
/// A type which has gone through `cx.reveal_opaque_ty`, i.e. if it was opaque it was replaced by
/// the hidden type if allowed in the current body. This ensures we consistently inspect the hidden
/// types when we should.
///
/// Use `.inner()` or deref to get to the `Ty<'tcx>`.
// #[repr(transparent)]
// #[derive(Clone, Copy, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc.rs:51 RevealedTy
export type RevealedTy = Ty & { readonly [REVEALED]: true };
/** The tuple-struct constructor `RevealedTy(ty)` (a cast; header). */
export function RevealedTy(ty: Ty): RevealedTy {
  return ty as RevealedTy;
}

// impl<'tcx> fmt::Display for RevealedTy<'tcx>
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:54 fmt
export function display_RevealedTy(self: RevealedTy): string {
  return display_Ty(self);
}

// impl<'tcx> fmt::Debug for RevealedTy<'tcx>
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:60 fmt
export const debug_RevealedTy: Debug<RevealedTy> = (self, fmt) => debug_Ty(self, fmt);

// impl<'tcx> std::ops::Deref for RevealedTy<'tcx>
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:67 deref
RevealedTy.deref = function (self: RevealedTy): Ty {
  return self;
};

// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:73 inner
RevealedTy.inner = function (self: RevealedTy): Ty {
  return self;
};

/// Private fields of [`RustcPatCtxt`], separated out to permit record initialization syntax.
// #[derive(Clone, Default)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc.rs:107 RustcPatCtxtState
export class RustcPatCtxtState {
  constructor(
    /// Has a deref pattern been lowered? This is initialized to `false` and is updated by
    /// [`RustcPatCtxt::lower_pat`] in order to avoid performing deref-pattern-specific validation
    /// for everything containing patterns.
    // PORT: `Cell<bool>` is the field itself (PORTING §5).
    public has_lowered_deref_pat: boolean,
  ) {}

  /** The derived `Default` (`Default::default()` in check_match's `new_cx`). */
  static default(): RustcPatCtxtState {
    return new RustcPatCtxtState(false);
  }
}

// #[derive(Clone)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc.rs:79 RustcPatCtxt
export class RustcPatCtxt implements PatCx<RustcPatCtxtTypes> {
  constructor(
    public tcx: TyCtxt,
    public typeck_results: TypeckResults,
    /// The module in which the match occurs. This is necessary for
    /// checking inhabited-ness of types because whether a type is (visibly)
    /// inhabited can depend on whether it was defined in the current module or
    /// not. E.g., `struct Foo { _private: ! }` cannot be seen to be empty
    /// outside its module and should not be matchable with an empty match statement.
    public module: LocalModId,
    public typing_env: TypingEnv,
    /// To allocate the result of `self.ctor_sub_tys()`
    // PORT: rustc_arena's `DroplessArena` is erased (header); kept as an opaque field.
    public dropless_arena: unknown,
    /// Lint level at the match.
    public match_lint_level: HirId,
    /// The span of the whole match, if applicable.
    public whole_match_span: Span | undefined,
    /// Span of the scrutinee.
    public scrut_span: Span,
    /// Only produce `NON_EXHAUSTIVE_OMITTED_PATTERNS` lint on refutable patterns.
    public refutable: boolean,
    /// Whether the data at the scrutinee is known to be valid. This is false if the scrutinee comes
    /// from a union field, a pointer deref, or a reference deref (pending opsem decisions).
    public known_valid_scrutinee: boolean,
    public internal_state: RustcPatCtxtState,
  ) {}

  /// Type inference occasionally gives us opaque types in places where corresponding patterns
  /// have more specific types. To avoid inconsistencies as well as detect opaque uninhabited
  /// types, we use the corresponding hidden type if possible.
  // FIXME(#132279): This will be unnecessary once we have a TypingMode which supports revealing
  // opaque types defined in a body.
  // #[inline]
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:127 reveal_opaque_ty (lane pat-c)
  reveal_opaque_ty(_ty: Ty): RevealedTy {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::reveal_opaque_ty");
  }

  /// Returns the hidden type corresponding to this key if the body under analysis is allowed to
  /// know it.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:151 reveal_opaque_key (lane pat-c)
  reveal_opaque_key(_key: OpaqueTypeKey): Ty | undefined {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::reveal_opaque_key");
  }
  // This can take a non-revealed `Ty` because it reveals opaques itself.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:158 is_uninhabited (lane pat-c)
  is_uninhabited(_ty: Ty): boolean {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::is_uninhabited");
  }

  /// Returns whether the given type is an enum from another crate declared `#[non_exhaustive]`.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:168 is_foreign_non_exhaustive_enum (lane pat-c)
  is_foreign_non_exhaustive_enum(_ty: RevealedTy): boolean {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::is_foreign_non_exhaustive_enum");
  }

  /// Whether the range denotes the fictitious values before `isize::MIN` or after
  /// `usize::MAX`/`isize::MAX` (see doc of [`IntRange::split`] for why these exist).
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:177 is_range_beyond_boundaries (lane pat-c)
  is_range_beyond_boundaries(_range: IntRange, _ty: RevealedTy): boolean {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::is_range_beyond_boundaries");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:189 variant_sub_tys (lane pat-c)
  variant_sub_tys(_ty: RevealedTy, _variant: VariantDef): [FieldDef, RevealedTy][] {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::variant_sub_tys");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:215 variant_index_for_adt (lane pat-c)
  static variant_index_for_adt(_ctor: Constructor, _adt: AdtDef): VariantIdx {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::variant_index_for_adt");
  }

  /// Returns the types of the fields for a given constructor. The result must have a length of
  /// `ctor.arity()`.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:231 ctor_sub_tys (lane pat-c)
  ctor_sub_tys(_ctor: Constructor, _ty: RevealedTy): readonly (readonly [RevealedTy, PrivateUninhabitedField])[] {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::ctor_sub_tys");
  }

  /// The number of fields for this constructor.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:285 ctor_arity (lane pat-c)
  ctor_arity(_ctor: Constructor, _ty: RevealedTy): number {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::ctor_arity");
  }

  /// Creates a set that represents all the constructors of `ty`.
  ///
  /// See [`crate::constructor`] for considerations of emptiness.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:307 ctors_for_ty (lane pat-c)
  ctors_for_ty(_ty: RevealedTy): Result<ConstructorSet, ErrorGuaranteed> {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::ctors_for_ty");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:439 lower_pat_range_bdy (lane pat-c)
  lower_pat_range_bdy(_bdy: PatRangeBoundary, _ty: RevealedTy): MaybeInfiniteInt {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat_range_bdy");
  }

  /// Note: the input patterns must have been lowered through
  /// `rustc_mir_build::thir::pattern::check_match::MatchVisitor::lower_pattern`.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:462 lower_pat (lane pat-c)
  lower_pat(_pat: Pat): DeconstructedPat {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat");
  }

  /// Convert back to a `thir::PatRangeBoundary` for diagnostic purposes.
  /// Note: it is possible to get `isize/usize::MAX+1` here, as explained in the doc for
  /// [`IntRange::split`]. This cannot be represented as a `Const`, so we represent it with
  /// `PosInfinity`.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:715 hoist_pat_range_bdy (lane pat-c)
  hoist_pat_range_bdy(_miint: MaybeInfiniteInt, _ty: RevealedTy): PatRangeBoundary {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::hoist_pat_range_bdy");
  }

  /// Prints an [`IntRange`] to a string for diagnostic purposes.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:746 print_pat_range (lane pat-c)
  print_pat_range(_range: IntRange, _ty: RevealedTy): string {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::print_pat_range");
  }

  /// Prints a [`WitnessPat`] to an owned string, for diagnostic purposes.
  ///
  /// This panics for patterns that don't appear in diagnostics, like float ranges.
  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:784 print_witness_pat (lane pat-c)
  print_witness_pat(_pat: WitnessPat): string {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::print_witness_pat");
  }

  // ---- impl<'p, 'tcx: 'p> PatCx for RustcPatCtxt<'p, 'tcx> ----
  // type Ty = RevealedTy<'tcx>; type Error = ErrorGuaranteed; type VariantIdx = VariantIdx;
  // type StrLit = ty::Value<'tcx>; type ArmData = HirId; type PatData = &'p Pat<'tcx>;  (RustcPatCtxtTypes)

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:898 is_exhaustive_patterns_feature_on (lane pat-c)
  is_exhaustive_patterns_feature_on(): boolean {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::is_exhaustive_patterns_feature_on");
  }

  // (provided) lib.rs:55 exhaustive_witnesses -> PatCx_provided.exhaustive_witnesses
  exhaustive_witnesses(): boolean {
    return PatCx_provided.exhaustive_witnesses(this);
  }

  // PORT: the trait's `ctor_arity` (`self.ctor_arity(ctor, *ty)`), `ctor_sub_tys` (`self.ctor_sub_tys(ctor, *ty)`)
  // and `ctors_for_ty` (`self.ctors_for_ty(*ty)`) are the inherent methods above (header).
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:902 ctor_arity
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:905 ctor_sub_tys
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:912 ctors_for_ty

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:919 write_variant_name (lane pat-c)
  write_variant_name(_f: Fmt, _ctor: Constructor, _ty: RevealedTy): string {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::write_variant_name");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:931 bug (lane pat-c)
  bug(_fmt: string): ErrorGuaranteed {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::bug");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:935 delayed_bug (lane pat-c)
  delayed_bug(_fmt: string): ErrorGuaranteed {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::delayed_bug");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:939 lint_overlapping_range_endpoints (lane pat-c)
  lint_overlapping_range_endpoints(_pat: DeconstructedPat, _overlaps_on: IntRange, _overlaps_with: readonly DeconstructedPat[]): void {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::lint_overlapping_range_endpoints");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:960 complexity_exceeded (lane pat-c)
  complexity_exceeded(): Result<null, ErrorGuaranteed> {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::complexity_exceeded");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:965 lint_non_contiguous_range_endpoints (lane pat-c)
  lint_non_contiguous_range_endpoints(_pat: DeconstructedPat, _gap: IntRange, _gapped_with: readonly DeconstructedPat[]): void {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::lint_non_contiguous_range_endpoints");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:1028 match_may_contain_deref_pats (lane pat-c)
  match_may_contain_deref_pats(): boolean {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::match_may_contain_deref_pats");
  }

  // stub: compiler/rustc_pattern_analysis/src/rustc.rs:1032 report_mixed_deref_pat_ctors (lane pat-c)
  report_mixed_deref_pat_ctors(_deref_pat: DeconstructedPat, _normal_pat: DeconstructedPat): ErrorGuaranteed {
    return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::report_mixed_deref_pat_ctors");
  }

  // ---- the static side of `PatCx` (lib.ts `PatCxStatic`; header) ----
  /** `<RevealedTy as fmt::Debug>::fmt` */
  debug_Ty(v: RevealedTy, f: Fmt): string {
    return debug_RevealedTy(v, f);
  }
  /** `<VariantIdx as fmt::Debug>::fmt` (`newtype_index!`: the number) */
  debug_VariantIdx(v: VariantIdx, _f: Fmt): string {
    return `${v}`;
  }
  /** `<ty::Value as fmt::Debug>::fmt` */
  debug_StrLit(v: Value, f: Fmt): string {
    return debug_Value(v, f);
  }
  /** `<HirId as fmt::Debug>::fmt` */
  debug_ArmData(v: HirId, f: Fmt): string {
    return debug_HirId(v, f);
  }
  /** `<ty::Value as PartialEq>::eq` (derived: `ty` and `valtree`, both interned) */
  StrLit_eq(a: Value, b: Value): boolean {
    return a.ty === b.ty && a.valtree === b.valtree;
  }
}

// impl<'p, 'tcx: 'p> fmt::Debug for RustcPatCtxt<'p, 'tcx>
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:115 fmt
export const debug_RustcPatCtxt: Debug<RustcPatCtxt> = (_self, f) => debug_struct(f, "RustcPatCtxt", []);

// fn reveal_opaque_ty's inner fn
// stub: compiler/rustc_pattern_analysis/src/rustc.rs:128 reveal_inner (lane pat-c)
export function reveal_inner(_cx: RustcPatCtxt, _ty: Ty): RevealedTy {
  return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::reveal_opaque_ty::reveal_inner");
}

// fn ctor_sub_tys's inner fn
// stub: compiler/rustc_pattern_analysis/src/rustc.rs:236 reveal_and_alloc (lane pat-c)
export function reveal_and_alloc(_cx: RustcPatCtxt, _iter: Iterable<Ty>): readonly (readonly [RevealedTy, PrivateUninhabitedField])[] {
  return unported("rustc_pattern_analysis::rustc::RustcPatCtxt::ctor_sub_tys::reveal_and_alloc");
}

/// Returns `true` if the given pattern would be printed as a wildcard (`_`).
// stub: compiler/rustc_pattern_analysis/src/rustc.rs:875 would_print_as_wildcard (lane pat-c)
export function would_print_as_wildcard(_tcx: TyCtxt, _p: WitnessPat): boolean {
  return unported("rustc_pattern_analysis::rustc::would_print_as_wildcard");
}

/// Recursively expand this pattern into its subpatterns. Only useful for or-patterns.
// stub: compiler/rustc_pattern_analysis/src/rustc.rs:1049 expand_or_pat (lane pat-c)
export function expand_or_pat(_pat: Pat): Pat[] {
  return unported("rustc_pattern_analysis::rustc::expand_or_pat");
}

// fn expand_or_pat's inner fn
// stub: compiler/rustc_pattern_analysis/src/rustc.rs:1050 expand (lane pat-c)
export function expand(_pat: Pat, _vec: Pat[]): void {
  return unported("rustc_pattern_analysis::rustc::expand_or_pat::expand");
}

/// The entrypoint for this crate. Computes whether a match is exhaustive and which of its arms are
/// useful, and runs some lints.
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:1067 analyze_match
export function analyze_match(tycx: RustcPatCtxt, arms: readonly MatchArm[], scrut_ty: Ty): Result<UsefulnessReport, ErrorGuaranteed> {
  // PORT: the shadowing `let scrut_ty = ..` is `scrut_ty_`.
  const scrut_ty_ = tycx.reveal_opaque_ty(scrut_ty);

  const scrut_validity = PlaceValidity.from_bool(tycx.known_valid_scrutinee);
  const r = compute_match_usefulness(tycx, arms, scrut_ty_, scrut_validity, tycx.tcx.pattern_complexity_limit()._0);
  if (r.$ === "Err") return r;
  const report = r._0;

  // Run the non_exhaustive_omitted_patterns lint. Only run on refutable patterns to avoid hitting
  // `if let`s. Only run if the match is exhaustive otherwise the error is redundant.
  if (tycx.refutable && report.non_exhaustiveness_witnesses.length === 0) {
    const pat_column = PatternColumn.new(arms);
    const l = lint_nonexhaustive_missing_variants(tycx, arms, pat_column, scrut_ty_);
    if (l.$ === "Err") return l;
  }

  return Ok(report);
}
