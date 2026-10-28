// Port of compiler/rustc_pattern_analysis/src/rustc.rs (declarations: lane pat-b; bodies: lane pat-c).
//
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
// - `fmt::Arguments` handed to `bug` / `delayed_bug` is the formatted string; `{:?}` / `{}` inside messages use the
//   ported `Debug` / `Display` fns with a plain formatter.
import { FIRST_VARIANT, FieldIdx, type VariantIdx } from "../rustc_abi/layout.ts";
import { Integer } from "../rustc_abi/lib.ts";
import { debug_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import { NON_CONTIGUOUS_RANGE_ENDPOINTS, OVERLAPPING_RANGE_ENDPOINTS } from "../rustc_lint_defs/builtin.ts";
import { Const as MirConst } from "../rustc_middle/mir/consts.ts";
import {
  clone_PatRange,
  debug_PatKind,
  display_PatRange,
  type Pat,
  PatRange,
  PatRangeBoundary,
} from "../rustc_middle/thir.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import { debug_Value, display_Value, Value, ValTree } from "../rustc_middle/ty/consts/valtree.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TypeckResults } from "../rustc_middle/ty/decls.ts";
import { InhabitedPredicate } from "../rustc_middle/ty/inhabitedness/inhabited_predicate.ts";
import { IntegerExt } from "../rustc_middle/ty/layout.ts";
import { debug_TypingEnv, type FieldDef, type Ty, type TypingEnv, type VariantDef, Visibility } from "../rustc_middle/ty/mod.ts";
import { NormalizationError } from "../rustc_middle/ty/normalize_erasing_regions.ts";
import type { OpaqueTypeKey } from "../rustc_middle/ty/opaque_types.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import type { PrintResult } from "../rustc_middle/ty/print/mod.ts";
import { debug_AdtDef, debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { LocalModId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import { ValTreeKind } from "../rustc_type_ir/const_kind.ts";
import { debug_Unnormalized, Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { Double, Half, Quad, Single } from "../vendor/rustc_apfloat/ieee.ts";
import * as constructor from "./constructor.ts";
import { IntRange, MaybeInfiniteInt, OpaqueId, RangeEnd, Slice, SliceKind, VariantVisibility } from "./constructor.ts";
import * as diagnostics from "./diagnostics.gen.ts";
import { type PatCx, PatCx_provided, PrivateUninhabitedField } from "./lib.ts";
import type * as lib from "./lib.ts";
import { lint_nonexhaustive_missing_variants } from "./lints.ts";
import * as pat from "./pat.ts";
import { PatternColumn } from "./pat_column.ts";
import * as print from "./rustc/print.ts";
import { EnumInfo } from "./rustc/print.ts";
import * as usefulness from "./usefulness.ts";
import { compute_match_usefulness, PlaceValidity } from "./usefulness.ts";
import { type Debug, debug_str, debug_struct, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { u64_to_number } from "../rust_ts/u64.ts";

// mod print;
// PORT: `mod print;` is the `print` namespace import above.


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
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:127 reveal_opaque_ty
  reveal_opaque_ty(ty: Ty): RevealedTy {
    const kind = ty.kind();
    if (kind.$ === "Alias" && kind._0 === "No" && kind._1.kind.$ === "Opaque") {
      return reveal_inner(this, ty);
    } else {
      return RevealedTy(ty);
    }
  }

  /// Returns the hidden type corresponding to this key if the body under analysis is allowed to
  /// know it.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:151 reveal_opaque_key
  reveal_opaque_key(key: OpaqueTypeKey): Ty | undefined {
    const x = this.typeck_results.hidden_types.get(key.def_id);
    return x === undefined ? undefined : Unnormalized.skip_norm_wip(tyir_binder().EarlyBinder.instantiate(x.ty, this.tcx, key.args, fold_Ty));
  }
  // This can take a non-revealed `Ty` because it reveals opaques itself.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:158 is_uninhabited
  is_uninhabited(ty: Ty): boolean {
    return !InhabitedPredicate.apply_revealing_opaque(ty.inhabited_predicate(this.tcx), this.tcx, this.typing_env, this.module, (key) =>
      this.reveal_opaque_key(key),
    );
  }

  /// Returns whether the given type is an enum from another crate declared `#[non_exhaustive]`.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:168 is_foreign_non_exhaustive_enum
  is_foreign_non_exhaustive_enum(ty: RevealedTy): boolean {
    const kind = ty.kind();
    switch (kind.$) {
      case "Adt":
        return kind._0.variant_list_has_applicable_non_exhaustive();
      default:
        return false;
    }
  }

  /// Whether the range denotes the fictitious values before `isize::MIN` or after
  /// `usize::MAX`/`isize::MAX` (see doc of [`IntRange::split`] for why these exist).
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:177 is_range_beyond_boundaries
  is_range_beyond_boundaries(range: IntRange, ty: RevealedTy): boolean {
    return (
      ty.is_ptr_sized_integral() &&
      (() => {
        // The two invalid ranges are `NegInfinity..isize::MIN` (represented as
        // `NegInfinity..0`), and `{u,i}size::MAX+1..PosInfinity`. `hoist_pat_range_bdy`
        // converts `MAX+1` to `PosInfinity`, and we couldn't have `PosInfinity` in `range.lo`
        // otherwise.
        const lo = this.hoist_pat_range_bdy(range.lo, ty);
        return lo.$ === "PosInfinity" || (range.hi.$ === "Finite" && range.hi._0 === 0n);
      })()
    );
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:189 variant_sub_tys
  variant_sub_tys(ty: RevealedTy, variant: VariantDef): [FieldDef, RevealedTy][] {
    const kind = ty.kind();
    if (kind.$ !== "Adt") return bug();
    const args = kind._1;
    return variant.fields.map((field): [FieldDef, RevealedTy] => {
      const ty = field.ty(this.tcx, args);
      // `field.ty()` doesn't normalize after instantiating.
      const r = this.tcx.try_normalize_erasing_regions(this.typing_env, ty, fold_Ty);
      let ty_: Ty;
      if (r.$ === "Ok") {
        ty_ = r._0;
      } else {
        const e = r._0;
        this.tcx
          .dcx()
          .span_delayed_bug(
            this.scrut_span,
            `Failed to normalize ${debug_str(NormalizationError.get_type_for_failure(e))} in typing_env=${debug_TypingEnv(this.typing_env, PLAIN)} while getting variant sub tys for ${debug_Unnormalized(ty, PLAIN, debug_Ty)}`,
          );
        ty_ = Unnormalized.skip_norm_wip(ty);
      }
      const ty__ = this.reveal_opaque_ty(ty_);
      return [field, ty__];
    });
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:215 variant_index_for_adt
  static variant_index_for_adt(ctor: Constructor, adt: AdtDef): VariantIdx {
    switch (ctor.$) {
      case "Variant":
        return ctor._0;
      case "Struct":
      case "UnionField":
        assert(!adt.is_enum(), "assertion failed: !adt.is_enum()");
        return FIRST_VARIANT;
      default:
        return bug(`bad constructor ${debug_Constructor(ctor, PLAIN)} for adt ${debug_AdtDef_(adt)}`);
    }
  }

  /// Returns the types of the fields for a given constructor. The result must have a length of
  /// `ctor.arity()`.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:231 ctor_sub_tys
  ctor_sub_tys(ctor: Constructor, ty: RevealedTy): readonly (readonly [RevealedTy, PrivateUninhabitedField])[] {
    const cx = this;
    let slice: readonly (readonly [RevealedTy, PrivateUninhabitedField])[];
    switch (ctor.$) {
      case "Struct":
      case "Variant":
      case "UnionField": {
        const kind = ty.kind();
        switch (kind.$) {
          case "Tuple":
            slice = reveal_and_alloc(cx, kind._0);
            break;
          case "Adt": {
            const adt = kind._0;
            const variant = adt.variant(RustcPatCtxt.variant_index_for_adt(ctor, adt));
            const tys = cx.variant_sub_tys(ty, variant).map(([field, ty]): readonly [RevealedTy, PrivateUninhabitedField] => {
              const is_visible = adt.is_enum() || Visibility_is_accessible_from(field.vis, cx.module, cx.tcx);
              const is_uninhabited = cx.is_uninhabited(ty);
              const skip = is_uninhabited && !is_visible;
              return [ty, PrivateUninhabitedField(skip)];
            });
            // `cx.dropless_arena.alloc_from_iter(tys)`
            slice = tys;
            break;
          }
          default:
            return bug(`Unexpected type for constructor \`${debug_Constructor(ctor, PLAIN)}\`: ${debug_RevealedTy(ty, PLAIN)}`);
        }
        break;
      }
      case "Ref": {
        const kind = ty.kind();
        switch (kind.$) {
          case "Ref":
            slice = reveal_and_alloc(cx, [kind._1]);
            break;
          default:
            return bug(`Unexpected type for \`Ref\` constructor: ${debug_RevealedTy(ty, PLAIN)}`);
        }
        break;
      }
      case "Slice": {
        const ty_ = ty.builtin_index();
        if (ty_ !== undefined) {
          const arity = ctor._0.arity();
          const tys: Ty[] = [];
          for (let i = 0; i < arity; i++) tys.push(ty_);
          slice = reveal_and_alloc(cx, tys);
        } else {
          return bug(`bad slice pattern ${debug_Constructor(ctor, PLAIN)} ${debug_RevealedTy(ty, PLAIN)}`);
        }
        break;
      }
      case "DerefPattern": {
        const pointee_ty = ctor._0;
        slice = reveal_and_alloc(cx, [RevealedTy.inner(pointee_ty)]);
        break;
      }
      case "Bool":
      case "IntRange":
      case "F16Range":
      case "F32Range":
      case "F64Range":
      case "F128Range":
      case "Str":
      case "Opaque":
      case "Never":
      case "NonExhaustive":
      case "Hidden":
      case "Missing":
      case "PrivateUninhabited":
      case "Wildcard":
        slice = [];
        break;
      case "Or": {
        return bug("called `Fields::wildcards` on an `Or` ctor");
      }
    }
    // `slice.iter().copied()`
    return slice;
  }

  /// The number of fields for this constructor.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:285 ctor_arity
  ctor_arity(ctor: Constructor, ty: RevealedTy): number {
    switch (ctor.$) {
      case "Struct":
      case "Variant":
      case "UnionField": {
        const kind = ty.kind();
        switch (kind.$) {
          case "Tuple":
            return kind._0.length;
          case "Adt": {
            const adt = kind._0;
            const variant_idx = RustcPatCtxt.variant_index_for_adt(ctor, adt);
            return adt.variant(variant_idx).fields.length;
          }
          default:
            return bug(`Unexpected type for constructor \`${debug_Constructor(ctor, PLAIN)}\`: ${debug_RevealedTy(ty, PLAIN)}`);
        }
      }
      case "Ref":
      case "DerefPattern":
        return 1;
      case "Slice":
        return ctor._0.arity();
      case "Bool":
      case "IntRange":
      case "F16Range":
      case "F32Range":
      case "F64Range":
      case "F128Range":
      case "Str":
      case "Opaque":
      case "Never":
      case "NonExhaustive":
      case "Hidden":
      case "Missing":
      case "PrivateUninhabited":
      case "Wildcard":
        return 0;
      case "Or":
        return bug("The `Or` constructor doesn't have a fixed arity");
    }
  }

  /// Creates a set that represents all the constructors of `ty`.
  ///
  /// See [`crate::constructor`] for considerations of emptiness.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:307 ctors_for_ty
  ctors_for_ty(ty: RevealedTy): Result<ConstructorSet, ErrorGuaranteed> {
    const cx = this;
    const make_uint_range = (start: bigint, end: bigint): IntRange =>
      IntRange.from_range(MaybeInfiniteInt.new_finite_uint(start), MaybeInfiniteInt.new_finite_uint(end), RangeEnd.Included);
    // Abort on type error.
    const er = TypeVisitableExt.error_reported<Ty>(ty, fold_Ty);
    if (er.$ === "Err") return er;
    // This determines the set of all possible constructors for the type `ty`. For numbers,
    // arrays and slices we use ranges and variable-length slices when appropriate.
    const kind = ty.kind();
    let set: ConstructorSet;
    switch (kind.$) {
      case "Bool":
        set = ConstructorSet.Bool;
        break;
      case "Char": {
        // The valid Unicode Scalar Value ranges.
        set = {
          $: "Integers",
          range_1: make_uint_range(0x0000n, 0xd7ffn),
          range_2: make_uint_range(0xe000n, 0x10ffffn),
        };
        break;
      }
      case "Int": {
        const ity = kind._0;
        let range: IntRange;
        if (ty.is_ptr_sized_integral()) {
          // The min/max values of `isize` are not allowed to be observed.
          range = new IntRange(MaybeInfiniteInt.NegInfinity, MaybeInfiniteInt.PosInfinity);
        } else {
          const size = Integer.size(IntegerExt.from_int_ty(cx.tcx, ity)).bits();
          const min = 1n << BigInt(size - 1);
          const max = min - 1n;
          const min_ = MaybeInfiniteInt.new_finite_int(min, size);
          const max_ = MaybeInfiniteInt.new_finite_int(max, size);
          range = IntRange.from_range(min_, max_, RangeEnd.Included);
        }
        set = { $: "Integers", range_1: range, range_2: undefined };
        break;
      }
      case "Uint": {
        const uty = kind._0;
        let range: IntRange;
        if (ty.is_ptr_sized_integral()) {
          // The max value of `usize` is not allowed to be observed.
          const lo = MaybeInfiniteInt.new_finite_uint(0n);
          range = new IntRange(lo, MaybeInfiniteInt.PosInfinity);
        } else {
          const size = Integer.size(IntegerExt.from_uint_ty(cx.tcx, uty));
          const max = size.truncate(U128_MAX);
          range = make_uint_range(0n, max);
        }
        set = { $: "Integers", range_1: range, range_2: undefined };
        break;
      }
      case "Slice": {
        const sub_ty = kind._0;
        set = { $: "Slice", array_len: undefined, subtype_is_empty: cx.is_uninhabited(sub_ty) };
        break;
      }
      case "Array": {
        const [sub_ty, len] = [kind._0, kind._1];
        // We treat arrays of a constant but unknown length like slices.
        const array_len = len.try_to_target_usize(cx.tcx);
        set = {
          $: "Slice",
          array_len: array_len === undefined ? undefined : u64_to_number(array_len, "ConstructorSet::Slice"),
          subtype_is_empty: cx.is_uninhabited(sub_ty),
        };
        break;
      }
      case "Adt": {
        const [def, args] = [kind._0, kind._1];
        if (def.is_enum()) {
          const is_declared_nonexhaustive = cx.is_foreign_non_exhaustive_enum(ty);
          if (def.variants().length === 0 && !is_declared_nonexhaustive) {
            set = ConstructorSet.NoConstructors;
          } else {
            const variants: VariantVisibility[] = def.variants().map(() => VariantVisibility.Visible);
            def.variants().forEach((v, idx) => {
              const variant_def_id = def.variant(idx as VariantIdx).def_id;
              // Visibly uninhabited variants.
              const is_inhabited = InhabitedPredicate.apply_revealing_opaque(
                InhabitedPredicate.instantiate(v.inhabited_predicate(cx.tcx), cx.tcx, args),
                cx.tcx,
                cx.typing_env,
                cx.module,
                (key) => cx.reveal_opaque_key(key),
              );
              // Variants that depend on a disabled unstable feature.
              const is_unstable = cx.tcx.eval_stability(variant_def_id, undefined, DUMMY_SP, undefined).$ === "Deny";
              // Foreign `#[doc(hidden)]` variants.
              const is_doc_hidden = cx.tcx.is_doc_hidden(variant_def_id) && !variant_def_id.is_local();
              let visibility: VariantVisibility;
              if (!is_inhabited) {
                // FIXME: handle empty+hidden
                visibility = VariantVisibility.Empty;
              } else if (is_unstable || is_doc_hidden) {
                visibility = VariantVisibility.Hidden;
              } else {
                visibility = VariantVisibility.Visible;
              }
              variants[idx] = visibility;
            });

            set = { $: "Variants", variants, non_exhaustive: is_declared_nonexhaustive };
          }
        } else if (def.is_union()) {
          set = ConstructorSet.Union;
        } else {
          set = { $: "Struct", empty: cx.is_uninhabited(RevealedTy.inner(ty)) };
        }
        break;
      }
      case "Tuple":
        set = { $: "Struct", empty: cx.is_uninhabited(RevealedTy.inner(ty)) };
        break;
      case "Ref":
        set = ConstructorSet.Ref;
        break;
      case "Never":
        set = ConstructorSet.NoConstructors;
        break;
      // This type is one for which we cannot list constructors, like `str` or `f64`.
      // FIXME(Nadrieril): which of these are actually allowed?
      case "Float":
      case "Str":
      case "Foreign":
      case "RawPtr":
      case "FnDef":
      case "FnPtr":
      case "Pat":
      case "Dynamic":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "UnsafeBinder":
      case "Alias":
      case "Param":
      case "Error":
        set = ConstructorSet.Unlistable;
        break;
      case "CoroutineWitness":
      case "Bound":
      case "Placeholder":
      case "Infer":
        return bug(`Encountered unexpected type in \`ConstructorSet::for_ty\`: ${debug_RevealedTy(ty, PLAIN)}`);
    }
    return Ok(set);
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:439 lower_pat_range_bdy
  lower_pat_range_bdy(bdy: PatRangeBoundary, ty: RevealedTy): MaybeInfiniteInt {
    switch (bdy.$) {
      case "NegInfinity":
        return MaybeInfiniteInt.NegInfinity;
      case "Finite": {
        const value = bdy._0;
        const bits = ValTree_to_leaf(value).to_bits_unchecked();
        const kind = ty.kind();
        switch (kind.$) {
          case "Int": {
            const size = Integer.size(IntegerExt.from_int_ty(this.tcx, kind._0)).bits();
            return MaybeInfiniteInt.new_finite_int(bits, size);
          }
          default:
            return MaybeInfiniteInt.new_finite_uint(bits);
        }
      }
      case "PosInfinity":
        return MaybeInfiniteInt.PosInfinity;
    }
  }

  /// Note: the input patterns must have been lowered through
  /// `rustc_mir_build::thir::pattern::check_match::MatchVisitor::lower_pattern`.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:462 lower_pat
  lower_pat(pat: Pat): DeconstructedPat {
    const cx = this;
    const ty = cx.reveal_opaque_ty(pat.ty);
    let ctor: Constructor;
    let arity: number;
    let fields: pat_IndexedPat[];
    const pk = pat.kind;
    switch (pk.$) {
      case "Binding":
      case "Guard":
        if (pk.$ === "Guard" || pk.subpattern !== undefined) {
          return this.lower_pat(pk.subpattern!);
        }
        // `PatKind::Binding { subpattern: None, .. }`
        ctor = Constructor.Wildcard;
        fields = [];
        arity = 0;
        break;
      case "Missing":
      case "Wild":
        ctor = Constructor.Wildcard;
        fields = [];
        arity = 0;
        break;
      case "Deref": {
        const { pin, subpattern } = pk;
        fields = [this.lower_pat(subpattern).at_index(0)];
        arity = 1;
        const pr = ty.maybe_pinned_ref();
        if (pin === "Not" && pr !== undefined && pr[1] === "Not") {
          ctor = Constructor.Ref;
        } else if (pin === "Pinned" && pr !== undefined && pr[1] === "Pinned") {
          const inner_ty = pr[0];
          this.internal_state.has_lowered_deref_pat = true;
          ctor = { $: "DerefPattern", _0: RevealedTy(inner_ty) };
        } else {
          return span_bug(
            pat.span,
            `pattern has unexpected type: pat: ${debug_PatKind(pat.kind, PLAIN)}, ty: ${debug_Ty(RevealedTy.inner(ty), PLAIN)}`,
          );
        }
        break;
      }
      case "DerefPattern": {
        const { subpattern } = pk;
        // NB(deref_patterns): This assumes the deref pattern is matching on a trusted
        // `DerefPure` type. If the `Deref` impl isn't trusted, exhaustiveness must take
        // into account that multiple calls to deref may return different results. Hence
        // multiple deref! patterns cannot be exhaustive together unless each is exhaustive
        // by itself.
        fields = [this.lower_pat(subpattern).at_index(0)];
        arity = 1;
        ctor = { $: "DerefPattern", _0: cx.reveal_opaque_ty(subpattern.ty) };
        this.internal_state.has_lowered_deref_pat = true;
        break;
      }
      case "Leaf":
      case "Variant": {
        const { subpatterns } = pk;
        const kind = ty.kind();
        switch (kind.$) {
          case "Tuple": {
            ctor = Constructor.Struct;
            arity = kind._0.length;
            fields = subpatterns.map((ipat) => this.lower_pat(ipat.pattern).at_index(FieldIdx.index(ipat.field)));
            break;
          }
          case "Adt": {
            const adt = kind._0;
            if (pk.$ === "Leaf" && adt.is_union()) {
              ctor = Constructor.UnionField;
            } else if (pk.$ === "Leaf") {
              ctor = Constructor.Struct;
            } else if (pk.$ === "Variant") {
              ctor = { $: "Variant", _0: pk.variant_index };
            } else {
              return bug();
            }
            const variant = adt.variant(RustcPatCtxt.variant_index_for_adt(ctor, adt));
            arity = variant.fields.length;
            fields = subpatterns.map((ipat) => this.lower_pat(ipat.pattern).at_index(FieldIdx.index(ipat.field)));
            break;
          }
          default:
            return span_bug(
              pat.span,
              `pattern has unexpected type: pat: ${debug_PatKind(pat.kind, PLAIN)}, ty: ${display_Ty(RevealedTy.inner(ty))}`,
            );
        }
        break;
      }
      case "Constant": {
        const { value } = pk;
        const kind = ty.kind();
        switch (kind.$) {
          case "Bool": {
            ctor = { $: "Bool", _0: unwrap(Value.try_to_bool(value)) };
            fields = [];
            arity = 0;
            break;
          }
          case "Char":
          case "Int":
          case "Uint": {
            {
              const bits = Value.to_leaf(value).to_bits_unchecked();
              let x: MaybeInfiniteInt;
              const k = ty.kind();
              switch (k.$) {
                case "Int": {
                  const size = Integer.size(IntegerExt.from_int_ty(cx.tcx, k._0)).bits();
                  x = MaybeInfiniteInt.new_finite_int(bits, size);
                  break;
                }
                default:
                  x = MaybeInfiniteInt.new_finite_uint(bits);
              }
              ctor = { $: "IntRange", _0: IntRange.from_singleton(x) };
            }
            fields = [];
            arity = 0;
            break;
          }
          case "Float":
            switch (kind._0) {
              case "F16": {
                // use rustc_apfloat::Float;
                const bits = Value.to_leaf(value).to_u16();
                const value_ = Half.from_bits(BigInt(bits));
                ctor = { $: "F16Range", _0: value_, _1: value_, _2: RangeEnd.Included };
                fields = [];
                arity = 0;
                break;
              }
              case "F32": {
                // use rustc_apfloat::Float;
                const bits = Value.to_leaf(value).to_u32();
                const value_ = Single.from_bits(BigInt(bits));
                ctor = { $: "F32Range", _0: value_, _1: value_, _2: RangeEnd.Included };
                fields = [];
                arity = 0;
                break;
              }
              case "F64": {
                // use rustc_apfloat::Float;
                const bits = Value.to_leaf(value).to_u64();
                const value_ = Double.from_bits(bits);
                ctor = { $: "F64Range", _0: value_, _1: value_, _2: RangeEnd.Included };
                fields = [];
                arity = 0;
                break;
              }
              case "F128": {
                // use rustc_apfloat::Float;
                const bits = Value.to_leaf(value).to_u128();
                const value_ = Quad.from_bits(bits);
                ctor = { $: "F128Range", _0: value_, _1: value_, _2: RangeEnd.Included };
                fields = [];
                arity = 0;
                break;
              }
            }
            break;
          case "Str": {
            // For constant/literal patterns of type `&str`, the THIR
            // pattern is a `PatKind::Deref` of type `&str` wrapping a
            // `PatKind::Const` of type `str`.
            ctor = { $: "Str", _0: value };
            fields = [];
            arity = 0;
            break;
          }
          // All constants that can be structurally matched have already been expanded
          // into the corresponding `Pat`s by `const_to_pat`. Constants that remain are
          // opaque.
          default: {
            ctor = { $: "Opaque", _0: OpaqueId.new() };
            fields = [];
            arity = 0;
          }
        }
        break;
      }
      case "Range": {
        const patrange = pk._0;
        const { lo, hi, end: end_ } = patrange;
        let end: RangeEnd;
        switch (end_) {
          case "Included":
            end = RangeEnd.Included;
            break;
          case "Excluded":
            end = RangeEnd.Excluded;
            break;
        }
        const kind = ty.kind();
        switch (kind.$) {
          case "Char":
          case "Int":
          case "Uint": {
            const lo_ = cx.lower_pat_range_bdy(lo, ty);
            const hi_ = cx.lower_pat_range_bdy(hi, ty);
            ctor = { $: "IntRange", _0: IntRange.from_range(lo_, hi_, end) };
            break;
          }
          case "Float": {
            const fty = kind._0;
            // use rustc_apfloat::Float;
            const lo_bits = map_opt(PatRangeBoundary.as_finite(lo), (c) => ValTree_to_leaf(c).to_bits_unchecked());
            const hi_bits = map_opt(PatRangeBoundary.as_finite(hi), (c) => ValTree_to_leaf(c).to_bits_unchecked());
            switch (fty) {
              case "F16": {
                // use rustc_apfloat::ieee::Half;
                const lo_ = lo_bits !== undefined ? Half.from_bits(lo_bits) : Half.INFINITY.neg();
                const hi_ = hi_bits !== undefined ? Half.from_bits(hi_bits) : Half.INFINITY;
                ctor = { $: "F16Range", _0: lo_, _1: hi_, _2: end };
                break;
              }
              case "F32": {
                // use rustc_apfloat::ieee::Single;
                const lo_ = lo_bits !== undefined ? Single.from_bits(lo_bits) : Single.INFINITY.neg();
                const hi_ = hi_bits !== undefined ? Single.from_bits(hi_bits) : Single.INFINITY;
                ctor = { $: "F32Range", _0: lo_, _1: hi_, _2: end };
                break;
              }
              case "F64": {
                // use rustc_apfloat::ieee::Double;
                const lo_ = lo_bits !== undefined ? Double.from_bits(lo_bits) : Double.INFINITY.neg();
                const hi_ = hi_bits !== undefined ? Double.from_bits(hi_bits) : Double.INFINITY;
                ctor = { $: "F64Range", _0: lo_, _1: hi_, _2: end };
                break;
              }
              case "F128": {
                // use rustc_apfloat::ieee::Quad;
                const lo_ = lo_bits !== undefined ? Quad.from_bits(lo_bits) : Quad.INFINITY.neg();
                const hi_ = hi_bits !== undefined ? Quad.from_bits(hi_bits) : Quad.INFINITY;
                ctor = { $: "F128Range", _0: lo_, _1: hi_, _2: end };
                break;
              }
            }
            break;
          }
          default:
            return span_bug(pat.span, `invalid type for range pattern: ${display_Ty(RevealedTy.inner(ty))}`);
        }
        fields = [];
        arity = 0;
        break;
      }
      case "Array":
      case "Slice": {
        const { prefix, slice, suffix } = pk;
        let array_len: number | undefined;
        const kind = ty.kind();
        switch (kind.$) {
          case "Array": {
            const length = kind._1;
            array_len = u64_to_number(unwrap(length.try_to_target_usize(cx.tcx), "expected len of array pat to be definite"), "Slice::new");
            break;
          }
          case "Slice":
            array_len = undefined;
            break;
          default:
            return span_bug(pat.span, `bad ty ${display_Ty(RevealedTy.inner(ty))} for slice pattern`);
        }
        const kind_: SliceKind =
          slice !== undefined
            ? { $: "VarLen", _0: prefix.length, _1: suffix.length }
            : { $: "FixedLen", _0: prefix.length + suffix.length };
        ctor = { $: "Slice", _0: Slice.new(array_len, kind_) };
        fields = [...prefix, ...suffix].map((p) => this.lower_pat(p)).map((p, i) => p.at_index(i));
        arity = SliceKind.arity(kind_);
        break;
      }
      case "Or": {
        ctor = Constructor.Or;
        const pats = expand_or_pat(pat);
        fields = pats.map((p) => this.lower_pat(p)).map((p, i) => p.at_index(i));
        arity = fields.length;
        break;
      }
      case "Never": {
        // A never pattern matches all the values of its type (namely none). Moreover it
        // must be compatible with other constructors, since we can use `!` on a type like
        // `Result<!, !>` which has other constructors. Hence we lower it as a wildcard.
        ctor = Constructor.Wildcard;
        fields = [];
        arity = 0;
        break;
      }
      case "Error": {
        ctor = { $: "Opaque", _0: OpaqueId.new() };
        fields = [];
        arity = 0;
        break;
      }
    }
    return DeconstructedPat.new(ctor, fields, arity, ty, pat);
  }

  /// Convert back to a `thir::PatRangeBoundary` for diagnostic purposes.
  /// Note: it is possible to get `isize/usize::MAX+1` here, as explained in the doc for
  /// [`IntRange::split`]. This cannot be represented as a `Const`, so we represent it with
  /// `PosInfinity`.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:715 hoist_pat_range_bdy
  hoist_pat_range_bdy(miint: MaybeInfiniteInt, ty: RevealedTy): PatRangeBoundary {
    // use MaybeInfiniteInt::*;
    const tcx = this.tcx;
    switch (miint.$) {
      case "NegInfinity":
        return PatRangeBoundary.NegInfinity;
      case "Finite": {
        const size = ty.primitive_size(tcx);
        let bits: bigint;
        switch (ty.kind().$) {
          case "Int":
            bits = unwrap(MaybeInfiniteInt.as_finite_int(miint, size.bits()));
            break;
          default:
            bits = unwrap(MaybeInfiniteInt.as_finite_uint(miint));
        }
        const scalar = ScalarInt.try_from_uint(bits, size);
        if (scalar !== undefined) {
          const valtree = ValTree.from_scalar_int(tcx, scalar);
          return { $: "Finite", _0: valtree };
        } else {
          // The value doesn't fit. Since `x >= 0` and 0 always encodes the minimum value
          // for a type, the problem isn't that the value is too small. So it must be too
          // large.
          return PatRangeBoundary.PosInfinity;
        }
      }
      case "PosInfinity":
        return PatRangeBoundary.PosInfinity;
    }
  }

  /// Prints an [`IntRange`] to a string for diagnostic purposes.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:746 print_pat_range
  print_pat_range(range: IntRange, ty: RevealedTy): string {
    // use MaybeInfiniteInt::*;
    const cx = this;
    if (range.lo.$ === "NegInfinity" && range.hi.$ === "PosInfinity") {
      return "_";
    } else if (range.is_singleton()) {
      const lo = cx.hoist_pat_range_bdy(range.lo, ty);
      const value: Value = { ty: RevealedTy.inner(ty), valtree: unwrap(PatRangeBoundary.as_finite(lo)) };
      return display_Value(value);
    } else {
      // We convert to an inclusive range for diagnostics.
      let end: RangeEnd = "Included";
      let lo = cx.hoist_pat_range_bdy(range.lo, ty);
      if (lo.$ === "PosInfinity") {
        // The only reason to get `PosInfinity` here is the special case where
        // `hoist_pat_range_bdy` found `{u,i}size::MAX+1`. So the range denotes the
        // fictitious values after `{u,i}size::MAX` (see [`IntRange::split`] for why we do
        // this). We show this to the user as `usize::MAX..` which is slightly incorrect but
        // probably clear enough.
        // PORT: upstream's `numeric_max_val` returns a `mir::Const` (util.rs:1152); rustc_middle ty/decls.ts declares
        // it with `ty::Const` (its body, `mir::Const::from_bits`, is still unported): cast to the upstream type.
        const max = unwrap(ty.numeric_max_val(cx.tcx)) as unknown as MirConst;
        const max_ = ValTree.from_scalar_int(cx.tcx, unwrap(MirConst.try_to_scalar_int(max)));
        lo = { $: "Finite", _0: max_ };
      }
      let hi: MaybeInfiniteInt;
      const hi_ = MaybeInfiniteInt.minus_one(range.hi);
      if (hi_ !== undefined) {
        hi = hi_;
      } else {
        // The range encodes `..ty::MIN`, so we can't convert it to an inclusive range.
        end = "Excluded";
        hi = range.hi;
      }
      const hi__ = cx.hoist_pat_range_bdy(hi, ty);
      return display_PatRange(new PatRange(lo, hi__, end, RevealedTy.inner(ty)));
    }
  }

  /// Prints a [`WitnessPat`] to an owned string, for diagnostic purposes.
  ///
  /// This panics for patterns that don't appear in diagnostics, like float ranges.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:784 print_witness_pat
  print_witness_pat(pat: WitnessPat): string {
    const cx = this;
    const print_ = (p: WitnessPat) => cx.print_witness_pat(p);
    const ctor = pat.ctor();
    switch (ctor.$) {
      case "Bool":
        return `${ctor._0}`;
      case "Str":
        return display_Value(ctor._0);
      case "IntRange":
        return this.print_pat_range(ctor._0, pat.ty());
      case "Struct":
      case "Variant":
      case "UnionField": {
        let enum_info: EnumInfo;
        const kind = pat.ty().kind();
        if (kind.$ === "Adt" && kind._0.is_enum()) {
          const adt_def = kind._0;
          enum_info = { $: "Enum", adt_def, variant_index: RustcPatCtxt.variant_index_for_adt(pat.ctor(), adt_def) };
        } else if (kind.$ === "Adt" || kind.$ === "Tuple") {
          enum_info = EnumInfo.NotEnum;
        } else {
          return bug(`unexpected ctor for type ${debug_Constructor(pat.ctor(), PLAIN)} ${debug_RevealedTy(pat.ty(), PLAIN)}`);
        }

        const subpatterns: print.FieldPat[] = pat.iter_fields().map((pat, i) => ({
          field: FieldIdx.new(i),
          pattern: print_(pat),
          is_wildcard: would_print_as_wildcard(cx.tcx, pat),
        }));

        const s: MutRef<string> = { value: "" };
        print_unwrap(print.write_struct_like(s, this.tcx, RevealedTy.inner(pat.ty()), enum_info, subpatterns));
        return s.value;
      }
      case "Ref": {
        const s: MutRef<string> = { value: "" };
        print_unwrap(print.write_ref_like(s, RevealedTy.inner(pat.ty()), print_(pat.fields[0]!)));
        return s.value;
      }
      case "DerefPattern":
        return `deref!(${print_(pat.fields[0]!)})`;
      case "Slice": {
        const slice = ctor._0;
        let prefix_len: number;
        let has_dot_dot: boolean;
        switch (slice.kind.$) {
          case "FixedLen":
            [prefix_len, has_dot_dot] = [slice.kind._0, false];
            break;
          case "VarLen":
            [prefix_len, has_dot_dot] = [slice.kind._0, true];
            break;
        }

        let prefix = pat.fields.slice(0, prefix_len);
        let suffix = pat.fields.slice(prefix_len);

        // If the pattern contains a `..`, but is applied to values of statically-known
        // length (arrays), then we can slightly simplify diagnostics by merging any
        // adjacent wildcard patterns into the `..`: `[x, _, .., _, y]` => `[x, .., y]`.
        // (This simplification isn't allowed for slice values, because in that case
        // `[x, .., y]` would match some slices that `[x, _, .., _, y]` would not.)
        if (has_dot_dot && slice.array_len !== undefined) {
          while (prefix.length > 0 && would_print_as_wildcard(cx.tcx, prefix[prefix.length - 1]!)) {
            prefix = prefix.slice(0, -1);
          }
          while (suffix.length > 0 && would_print_as_wildcard(cx.tcx, suffix[0]!)) {
            suffix = suffix.slice(1);
          }
        }

        const prefix_ = prefix.map(print_);
        const suffix_ = suffix.map(print_);

        const s: MutRef<string> = { value: "" };
        print_unwrap(print.write_slice_like(s, prefix_, has_dot_dot, suffix_));
        return s.value;
      }
      case "Never":
        if (this.tcx.features().never_patterns()) return "!";
        return "_";
      case "Wildcard":
      case "NonExhaustive":
      case "Hidden":
      case "PrivateUninhabited":
        return "_";
      case "Missing":
        return bug(
          "trying to convert a `Missing` constructor into a `Pat`; this is probably a bug,\n                `Missing` should have been processed in `apply_constructors`",
        );
      case "F16Range":
      case "F32Range":
      case "F64Range":
      case "F128Range":
      case "Opaque":
      case "Or":
        return bug(`can't convert to pattern: ${debug_WitnessPat_rustc(pat, PLAIN)}`);
    }
  }

  // ---- impl<'p, 'tcx: 'p> PatCx for RustcPatCtxt<'p, 'tcx> ----
  // type Ty = RevealedTy<'tcx>; type Error = ErrorGuaranteed; type VariantIdx = VariantIdx;
  // type StrLit = ty::Value<'tcx>; type ArmData = HirId; type PatData = &'p Pat<'tcx>;  (RustcPatCtxtTypes)

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:898 is_exhaustive_patterns_feature_on
  is_exhaustive_patterns_feature_on(): boolean {
    return this.tcx.features().exhaustive_patterns();
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

  // PORT: an associated fn (static side, lib.ts `PatCxStatic`): it never reads `this`, so `RustcPatCtxt.prototype`
  // can serve it.
  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:919 write_variant_name
  write_variant_name(_f: Fmt, ctor: Constructor, ty: RevealedTy): string {
    let out = "";
    const kind = ty.kind();
    if (kind.$ === "Adt") {
      const adt = kind._0;
      const variant = adt.variant(RustcPatCtxt.variant_index_for_adt(ctor, adt));
      out += display_Symbol(variant.name);
    }
    return out;
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:931 bug
  bug(fmt: string): ErrorGuaranteed {
    return span_bug(this.scrut_span, fmt);
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:935 delayed_bug
  delayed_bug(fmt: string): ErrorGuaranteed {
    return this.tcx.dcx().span_delayed_bug(this.scrut_span, fmt);
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:939 lint_overlapping_range_endpoints
  lint_overlapping_range_endpoints(pat: DeconstructedPat, overlaps_on: IntRange, overlaps_with: readonly DeconstructedPat[]): void {
    const overlap_as_pat = this.print_pat_range(overlaps_on, pat.ty());
    const overlaps: diagnostics.Overlap[] = overlaps_with
      .map((pat) => pat.data().span)
      .map((span) => ({ range: overlap_as_pat, span }));
    const pat_span = pat.data().span;
    this.tcx.emit_node_span_lint(
      OVERLAPPING_RANGE_ENDPOINTS,
      this.match_lint_level,
      pat_span,
      diagnostics.OverlappingRangeEndpoints_diagnostic({ overlap: overlaps, range: pat_span }),
    );
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:960 complexity_exceeded
  complexity_exceeded(): Result<null, ErrorGuaranteed> {
    const span = this.whole_match_span ?? this.scrut_span;
    return Err(this.tcx.dcx().span_err(span, "reached pattern complexity limit"));
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:965 lint_non_contiguous_range_endpoints
  lint_non_contiguous_range_endpoints(pat: DeconstructedPat, gap: IntRange, gapped_with: readonly DeconstructedPat[]): void {
    const thir_pat = pat.data();
    if (thir_pat.kind.$ !== "Range") return;
    const range = thir_pat.kind._0;
    // Only lint when the left range is an exclusive range.
    if (range.end !== "Excluded") {
      return;
    }
    // `pat` is an exclusive range like `lo..gap`. `gapped_with` contains ranges that start with
    // `gap+1`.
    const suggested_range: string = (() => {
      // Suggest `lo..=gap` instead.
      const suggested_range = clone_PatRange(range);
      suggested_range.end = "Included";
      return display_PatRange(suggested_range);
    })();
    const gap_as_pat = this.print_pat_range(gap, pat.ty());
    if (gapped_with.length === 0) {
      // If `gapped_with` is empty, `gap == T::MAX`.
      this.tcx.emit_node_span_lint(
        NON_CONTIGUOUS_RANGE_ENDPOINTS,
        this.match_lint_level,
        thir_pat.span,
        diagnostics.ExclusiveRangeMissingMax_diagnostic({
          // Point at this range.
          first_range: thir_pat.span,
          // That's the gap that isn't covered.
          max: gap_as_pat,
          // Suggest `lo..=max` instead.
          suggestion: suggested_range,
        }),
      );
    } else {
      this.tcx.emit_node_span_lint(
        NON_CONTIGUOUS_RANGE_ENDPOINTS,
        this.match_lint_level,
        thir_pat.span,
        diagnostics.ExclusiveRangeMissingGap_diagnostic({
          // Point at this range.
          first_range: thir_pat.span,
          // That's the gap that isn't covered.
          gap: gap_as_pat,
          // Suggest `lo..=gap` instead.
          suggestion: suggested_range,
          // All these ranges skipped over `gap` which we think is probably a
          // mistake.
          gap_with: gapped_with.map((pat) => ({
            span: pat.data().span,
            gap: gap_as_pat,
            first_range: display_PatRange(range),
          })),
        }),
      );
    }
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:1028 match_may_contain_deref_pats
  match_may_contain_deref_pats(): boolean {
    return this.internal_state.has_lowered_deref_pat;
  }

  // rustc: compiler/rustc_pattern_analysis/src/rustc.rs:1032 report_mixed_deref_pat_ctors
  report_mixed_deref_pat_ctors(deref_pat: DeconstructedPat, normal_pat: DeconstructedPat): ErrorGuaranteed {
    const deref_pattern_label = deref_pat.data().span;
    const normal_constructor_label = normal_pat.data().span;
    return this.tcx.dcx().emit_err(
      diagnostics.MixedDerefPatternConstructors_diagnostic({
        spans: [deref_pattern_label, normal_constructor_label],
        smart_pointer_ty: RevealedTy.inner(deref_pat.ty()),
        deref_pattern_label,
        normal_constructor_label,
      }),
    );
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
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:128 reveal_inner
export function reveal_inner(cx: RustcPatCtxt, ty: Ty): RevealedTy {
  // debug_assert!(!cx.tcx.next_trait_solver_globally());
  const kind = ty.kind();
  if (!(kind.$ === "Alias" && kind._1.kind.$ === "Opaque")) {
    return bug();
  }
  const def_id = kind._1.kind.def_id;
  const args = kind._1.args;
  const local_def_id = def_id.as_local();
  if (local_def_id !== undefined) {
    const key: OpaqueTypeKey = { def_id: local_def_id, args };
    const ty_ = cx.reveal_opaque_key(key);
    if (ty_ !== undefined) {
      return RevealedTy(ty_);
    }
  }
  return RevealedTy(ty);
}

// fn ctor_sub_tys's inner fn
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:236 reveal_and_alloc
export function reveal_and_alloc(cx: RustcPatCtxt, iter: Iterable<Ty>): readonly (readonly [RevealedTy, PrivateUninhabitedField])[] {
  // `cx.dropless_arena.alloc_from_iter(..)` is the array (header).
  return Array.from(iter, (ty) => cx.reveal_opaque_ty(ty)).map((ty) => [ty, PrivateUninhabitedField(false)] as const);
}

/// Returns `true` if the given pattern would be printed as a wildcard (`_`).
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:875 would_print_as_wildcard
export function would_print_as_wildcard(tcx: TyCtxt, p: WitnessPat): boolean {
  const ctor = p.ctor();
  switch (ctor.$) {
    case "IntRange":
      return ctor._0.lo.$ === "NegInfinity" && ctor._0.hi.$ === "PosInfinity";
    case "Wildcard":
    case "NonExhaustive":
    case "Hidden":
    case "PrivateUninhabited":
      return true;
    case "Never":
      if (!tcx.features().never_patterns()) return true;
      return false;
    default:
      return false;
  }
}

/// Recursively expand this pattern into its subpatterns. Only useful for or-patterns.
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:1049 expand_or_pat
export function expand_or_pat(pat: Pat): Pat[] {
  const pats: Pat[] = [];
  expand(pat, pats);
  return pats;
}

// fn expand_or_pat's inner fn
// rustc: compiler/rustc_pattern_analysis/src/rustc.rs:1050 expand
export function expand(pat: Pat, vec: Pat[]): void {
  if (pat.kind.$ === "Or") {
    for (const pat_ of pat.kind.pats) {
      expand(pat_, vec);
    }
  } else {
    vec.push(pat);
  }
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

// ---- local helpers (not ports) ----

/** `u128::MAX` */
const U128_MAX = (1n << 128n) - 1n;

/** `pat::IndexedPat` instantiated for rustc (the element type of `DeconstructedPat::fields`). */
type pat_IndexedPat = pat.IndexedPat<RustcPatCtxtTypes>;

/** `<Constructor as fmt::Debug>::fmt` for rustc's instantiation (static side: `RustcPatCtxt.prototype`). */
const debug_Constructor: Debug<Constructor> = (v, f) => constructor.debug_Constructor<RustcPatCtxtTypes>(RustcPatCtxt.prototype)(v, f);

/** `<WitnessPat as fmt::Debug>::fmt` for rustc's instantiation (static side: `RustcPatCtxt.prototype`). */
const debug_WitnessPat_rustc: Debug<WitnessPat> = (v, f) => pat.debug_WitnessPat<RustcPatCtxtTypes>(RustcPatCtxt.prototype)(v, f);

/** `{:?}` of an `AdtDef` (structural_impls.rs). */
function debug_AdtDef_(adt: AdtDef): string {
  return debug_AdtDef(adt, PLAIN);
}

/** `vis.is_accessible_from(module, tcx)` (rustc_middle ty/mod.rs `Visibility::is_accessible_from`). */
function Visibility_is_accessible_from(vis: FieldDef["vis"], module: LocalModId, tcx: TyCtxt): boolean {
  return Visibility.is_accessible_from(vis, module, tcx);
}

/** `ValTree` derefs to `ValTreeKind` (rustc_type_ir const_kind.rs): `valtree.to_leaf()`. */
function ValTree_to_leaf(valtree: ValTree): ScalarInt {
  return ValTreeKind.to_leaf(valtree.kind());
}

/** `Option::map`. */
function map_opt<T, U>(v: T | undefined, f: (v: T) => U): U | undefined {
  return v === undefined ? undefined : f(v);
}

/** `fmt::Result::unwrap()` (writing into a `String` never fails). `fmt::Error`'s derived `Debug` is `Error`. */
function print_unwrap(r: PrintResult): void {
  unwrap_result(r, () => "Error");
}

/** rustc_type_ir binder.rs (`EarlyBinder::instantiate`), reached lazily (init order, as rustc_middle ty/mod.ts). */
function tyir_binder(): typeof import("../rustc_type_ir/binder.ts") {
  return (tyir_binder__m ??= require("../rustc_type_ir/binder.ts") as typeof import("../rustc_type_ir/binder.ts"));
}
var tyir_binder__m: typeof import("../rustc_type_ir/binder.ts") | undefined;
