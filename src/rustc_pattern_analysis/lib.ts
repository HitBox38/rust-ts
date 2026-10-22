//! Analysis of patterns, notably match exhaustiveness checking. The main entrypoint for this crate
//! is [`usefulness::compute_match_usefulness`]. For rustc-specific types and entrypoints, see the
//! [`rustc`] module.
//
// Port of compiler/rustc_pattern_analysis/src/lib.rs (lane pat-b, the crate's foundation; docs/handoff/pat-b.md).
//
// ## Conventions of the crate (all files; repeated in docs/handoff/pat-b.md)
// - **`Cx: PatCx` generics.** Every generic `Cx: PatCx` item is generic over a *types bundle* `Cx extends PatCxTypes`
//   (`Cx["Ty"]`, `Cx["VariantIdx"]`, .. are the associated types); the context object is a `PatCx<Cx>`. So
//   `fn f<Cx: PatCx>(cx: &Cx, ty: &Cx::Ty)` is `function f<Cx extends PatCxTypes>(cx: PatCx<Cx>, ty: Cx["Ty"])`, and
//   `Constructor<Cx>` / `DeconstructedPat<Cx>` / `MatchArm<'p, Cx>` take the bundle. rustc's bundle is
//   `RustcPatCtxtTypes` (rustc.ts); the tests' is `TestTypes` (tests/common.ts).
// - **What Rust reaches through the type `Cx`** (no `self`): the associated fn `Cx::write_variant_name` and the
//   `fmt::Debug` / `PartialEq` bounds of the associated types, is `PatCxStatic<Cx>`. `PatCx<Cx>` extends it, so a
//   context object is also its static side; Debug impls of generic types take one (`debug_Constructor(cx)`), and code
//   that only has the type passes the implementor's prototype (`RustcPatCtxt.prototype`).
// - **Provided methods** of `PatCx` are in `PatCx_provided` (PORTING §8); implementors that keep the default install
//   them as forwarding methods (`exhaustive_witnesses() { return PatCx_provided.exhaustive_witnesses(this); }`).
// - **Enums** are `$`-tagged unions with companion consts holding the unit singletons and the methods
//   (`Constructor.Wildcard`, `Constructor.is_covered_by(ctor, cx, other)`); payload-free enums are string unions.
// - **Copy values are immutable** (`IntRange`, `Slice`, `SliceKind`, `MaybeInfiniteInt`, `Constructor`, `PatOrWild`,
//   `MatchArm`), so a Rust copy may share the object; only `WitnessPat.fields` is written in place.
// - **Ids** (`OpaqueId`, `PatId`) are branded numbers from module-level counters (the upstream `static AtomicU32`s).
// - **`u128`** (`MaybeInfiniteInt::Finite`) is `bigint`; `usize` is `number`.
// - **`fmt::Formatter`** is `Fmt` and a `fmt` impl returns the written text (std/fmt.ts); `fmt::Arguments` handed to
//   `PatCx::bug` / `delayed_bug` is the formatted `string`.
// - **Iterators** returned by upstream fns (`impl Iterator`) are arrays.
// - **Stubs** of the later lanes (pat-a: usefulness, pat_column, lints, checks; pat-c: rustc, rustc/print) are
//   `// stub: <path>:<line> <name> (lane <lane>)` over the final signature with an `unported("..")` body
//   (src/rustc_pattern_analysis/contract.test.ts checks them against coverage).
import type { Constructor, ConstructorSet, IntRange } from "./constructor.ts";
import { type DeconstructedPat, debug_DeconstructedPat } from "./pat.ts";
import { type Debug, debug_bool, debug_struct, debug_tuple, type Fmt } from "../std/fmt.ts";
import type { Result } from "../std/result.ts";

export * as checks from "./checks.ts";
export * as constructor from "./constructor.ts";
export * as diagnostics from "./diagnostics.ts";
export * as lints from "./lints.ts";
export * as pat from "./pat.ts";
export * as pat_column from "./pat_column.ts";
export * as rustc from "./rustc.ts";
export * as usefulness from "./usefulness.ts";

// pub use rustc_index::{Idx, IndexVec}; // re-exported to avoid rustc_index version issues
// PORT: `IndexVec<I, T>` is `T[]` (PORTING §5); nothing to re-export.

/// `bool` newtype that indicates whether this is a privately uninhabited field that we should skip
/// during analysis.
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_pattern_analysis/src/lib.rs:31 PrivateUninhabitedField
export interface PrivateUninhabitedField {
  readonly _0: boolean;
}
const PRIVATE_UNINHABITED_FIELD_FALSE: PrivateUninhabitedField = Object.freeze({ _0: false });
const PRIVATE_UNINHABITED_FIELD_TRUE: PrivateUninhabitedField = Object.freeze({ _0: true });
/** The tuple-struct constructor `PrivateUninhabitedField(skip)` (shared frozen values: the struct is `Copy`). */
export function PrivateUninhabitedField(skip: boolean): PrivateUninhabitedField {
  return skip ? PRIVATE_UNINHABITED_FIELD_TRUE : PRIVATE_UNINHABITED_FIELD_FALSE;
}
/** The derived `Debug` of `PrivateUninhabitedField`. */
export const debug_PrivateUninhabitedField: Debug<PrivateUninhabitedField> = (v, f) =>
  debug_tuple(f, "PrivateUninhabitedField", [debug_bool(v._0, f)]);

/**
 * PORT: the associated types of `PatCx` (`type Ty`, `type Error`, ..) as a types bundle; see the header.
 * `VariantIdx: Idx` is a number (it indexes `IndexVec<Cx::VariantIdx, _>`, an array).
 */
export interface PatCxTypes {
  /// The type of a pattern.
  Ty: unknown;
  /// Errors that can abort analysis.
  Error: unknown;
  /// The index of an enum variant.
  VariantIdx: number;
  /// A string literal
  StrLit: unknown;
  /// Extra data to store in a match arm.
  ArmData: unknown;
  /// Extra data to store in a pattern.
  PatData: unknown;
}

/**
 * PORT: the part of `PatCx` that Rust reaches through the type `Cx` rather than a `&self`: the associated fn
 * `write_variant_name` and the bounds of the associated types (`type Ty: Clone + fmt::Debug`,
 * `type VariantIdx: Clone + Idx + fmt::Debug`, `type StrLit: Clone + PartialEq + fmt::Debug`,
 * `type ArmData: Copy + Clone + fmt::Debug`). `Clone` of `Ty` / `StrLit` / `PatData` is the identity: every
 * implementor's values are `Copy` or shared references.
 */
export interface PatCxStatic<Cx extends PatCxTypes> {
  /// Write the name of the variant represented by `pat`. Used for the best-effort `Debug` impl of
  /// `DeconstructedPat`. Only invoqued when `pat.ctor()` is `Struct | Variant(_) | UnionField`.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:76 write_variant_name
  write_variant_name(f: Fmt, ctor: Constructor<Cx>, ty: Cx["Ty"]): string;
  /** `<Cx::Ty as fmt::Debug>::fmt` */
  readonly debug_Ty: Debug<Cx["Ty"]>;
  /** `<Cx::VariantIdx as fmt::Debug>::fmt` */
  readonly debug_VariantIdx: Debug<Cx["VariantIdx"]>;
  /** `<Cx::StrLit as fmt::Debug>::fmt` */
  readonly debug_StrLit: Debug<Cx["StrLit"]>;
  /** `<Cx::ArmData as fmt::Debug>::fmt` */
  readonly debug_ArmData: Debug<Cx["ArmData"]>;
  /** `<Cx::StrLit as PartialEq>::eq` */
  StrLit_eq(a: Cx["StrLit"], b: Cx["StrLit"]): boolean;
}

/// Context that provides type information about constructors.
///
/// Most of the crate is parameterized on a type that implements this trait.
// pub trait PatCx: Sized + fmt::Debug
// rustc-trait: compiler/rustc_pattern_analysis/src/lib.rs:36 PatCx
export interface PatCx<Cx extends PatCxTypes> extends PatCxStatic<Cx> {
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:50 is_exhaustive_patterns_feature_on
  is_exhaustive_patterns_feature_on(): boolean;

  /// Whether to ensure the non-exhaustiveness witnesses we report for a complete set. This is
  /// `false` by default to avoid some exponential blowup cases such as
  /// <https://github.com/rust-lang/rust/issues/118437>.
  // (provided) lib.rs:55 exhaustive_witnesses -> PatCx_provided.exhaustive_witnesses
  exhaustive_witnesses(): boolean;

  /// The number of fields for this constructor.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:60 ctor_arity
  ctor_arity(ctor: Constructor<Cx>, ty: Cx["Ty"]): number;

  /// The types of the fields for this constructor. The result must contain `ctor_arity()` fields.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:63 ctor_sub_tys
  ctor_sub_tys(ctor: Constructor<Cx>, ty: Cx["Ty"]): readonly (readonly [Cx["Ty"], PrivateUninhabitedField])[];

  /// The set of all the constructors for `ty`.
  ///
  /// This must follow the invariants of `ConstructorSet`
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:72 ctors_for_ty
  ctors_for_ty(ty: Cx["Ty"]): Result<ConstructorSet<Cx>, Cx["Error"]>;

  // (lib.rs:76 write_variant_name: in `PatCxStatic`)

  /// Raise a bug.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:83 bug
  bug(fmt: string): Cx["Error"];

  /// Raise a delayed bug.
  // (provided) lib.rs:86 delayed_bug -> PatCx_provided.delayed_bug
  delayed_bug(fmt: string): Cx["Error"];

  /// Lint that the range `pat` overlapped with all the ranges in `overlaps_with`, where the range
  /// they overlapped over is `overlaps_on`. We only detect singleton overlaps.
  /// The default implementation does nothing.
  // (provided) lib.rs:93 lint_overlapping_range_endpoints -> PatCx_provided.lint_overlapping_range_endpoints
  lint_overlapping_range_endpoints(
    pat: DeconstructedPat<Cx>,
    overlaps_on: IntRange,
    overlaps_with: readonly DeconstructedPat<Cx>[],
  ): void;

  /// The maximum pattern complexity limit was reached.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:102 complexity_exceeded
  complexity_exceeded(): Result<null, Cx["Error"]>;

  /// Lint that there is a gap `gap` between `pat` and all of `gapped_with` such that the gap is
  /// not matched by another range. If `gapped_with` is empty, then `gap` is `T::MAX`. We only
  /// detect singleton gaps.
  /// The default implementation does nothing.
  // (provided) lib.rs:108 lint_non_contiguous_range_endpoints -> PatCx_provided.lint_non_contiguous_range_endpoints
  lint_non_contiguous_range_endpoints(pat: DeconstructedPat<Cx>, gap: IntRange, gapped_with: readonly DeconstructedPat<Cx>[]): void;

  /// Check if we may need to perform additional deref-pattern-specific validation.
  // (provided) lib.rs:117 match_may_contain_deref_pats -> PatCx_provided.match_may_contain_deref_pats
  match_may_contain_deref_pats(): boolean;

  /// The current implementation of deref patterns requires that they can't match on the same
  /// place as a normal constructor. Since this isn't caught by type-checking, we check it in the
  /// `PatCx` before running the analysis. This reports an error if the check fails.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:124 report_mixed_deref_pat_ctors
  report_mixed_deref_pat_ctors(deref_pat: DeconstructedPat<Cx>, normal_pat: DeconstructedPat<Cx>): Cx["Error"];
}

/** PORT: the provided methods of `PatCx` (PORTING §8), taking the implementor first. */
export const PatCx_provided = {
  /// Whether to ensure the non-exhaustiveness witnesses we report for a complete set. This is
  /// `false` by default to avoid some exponential blowup cases such as
  /// <https://github.com/rust-lang/rust/issues/118437>.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:55 exhaustive_witnesses
  exhaustive_witnesses<Cx extends PatCxTypes>(_self: PatCx<Cx>): boolean {
    return false;
  },

  /// Raise a delayed bug.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:86 delayed_bug
  delayed_bug<Cx extends PatCxTypes>(self: PatCx<Cx>, fmt: string): Cx["Error"] {
    return self.bug(fmt);
  },

  /// Lint that the range `pat` overlapped with all the ranges in `overlaps_with`, where the range
  /// they overlapped over is `overlaps_on`. We only detect singleton overlaps.
  /// The default implementation does nothing.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:93 lint_overlapping_range_endpoints
  lint_overlapping_range_endpoints<Cx extends PatCxTypes>(
    _self: PatCx<Cx>,
    _pat: DeconstructedPat<Cx>,
    _overlaps_on: IntRange,
    _overlaps_with: readonly DeconstructedPat<Cx>[],
  ): void {},

  /// Lint that there is a gap `gap` between `pat` and all of `gapped_with` such that the gap is
  /// not matched by another range. If `gapped_with` is empty, then `gap` is `T::MAX`. We only
  /// detect singleton gaps.
  /// The default implementation does nothing.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:108 lint_non_contiguous_range_endpoints
  lint_non_contiguous_range_endpoints<Cx extends PatCxTypes>(
    _self: PatCx<Cx>,
    _pat: DeconstructedPat<Cx>,
    _gap: IntRange,
    _gapped_with: readonly DeconstructedPat<Cx>[],
  ): void {},

  /// Check if we may need to perform additional deref-pattern-specific validation.
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:117 match_may_contain_deref_pats
  match_may_contain_deref_pats<Cx extends PatCxTypes>(_self: PatCx<Cx>): boolean {
    return true;
  },
};

/// The arm of a match expression.
// #[derive(Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/lib.rs:133 MatchArm
export interface MatchArm<Cx extends PatCxTypes> {
  readonly pat: DeconstructedPat<Cx>;
  readonly has_guard: boolean;
  readonly arm_data: Cx["ArmData"];
}

/** `impl Clone for MatchArm` (and `Copy`). */
export const MatchArm = {
  // rustc: compiler/rustc_pattern_analysis/src/lib.rs:140 clone
  clone<Cx extends PatCxTypes>(self: MatchArm<Cx>): MatchArm<Cx> {
    // `*self`
    return { pat: self.pat, has_guard: self.has_guard, arm_data: self.arm_data };
  },
};

/** The derived `Debug` of `MatchArm` (`cx`: the static side of `Cx`, header). */
export function debug_MatchArm<Cx extends PatCxTypes>(cx: PatCxStatic<Cx>): Debug<MatchArm<Cx>> {
  return (v, f) =>
    debug_struct(f, "MatchArm", [
      ["pat", debug_DeconstructedPat(cx)(v.pat, f)],
      ["has_guard", debug_bool(v.has_guard, f)],
      ["arm_data", cx.debug_ArmData(v.arm_data, f)],
    ]);
}
