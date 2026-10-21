// Port of compiler/rustc_middle/src/ty/layout.rs. Lane typeck-gaps ported `IntegerExt` (except `discr_range_of_repr`) and
// `impl HasDataLayout for TyCtxt`; lane layout-contract added the types with their Debug, the `LayoutOf` glue
// (`HasTyCtxt` / `HasTypingEnv` / `MaybeResult` / `LayoutOfHelpers` / `LayoutOf`, their impls for `TyCtxt`, `TyCtxtAt`
// and `LayoutCx`), `LayoutCx::new`, the `TyAbiInterface` registration, and a `// stub:` declaration of every other fn
// for lane middle-layout (docs/handoff/layout-contract.md "How to fill a stub").
//
// PORT (layout-contract):
// - `#[extension(pub trait IntegerExt / FloatExt / PrimitiveExt)]` are companion consts whose fns take the receiver first
//   (PORTING §8).
// - `HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are the TS methods `tcx_()` / `typing_env_()`: most implementors
//   already have a `tcx` field (`TyCtxtAt`, `LateContext`, `FnCtxt`) or a `typing_env` field (`LayoutCx`), so the trait
//   methods carry the trailing underscore (precedent rustc_lint context.ts `LateContext::tcx_` / `typing_env_`).
// - Associated types are readonly members holding the impl's descriptor (precedent rustc_privacy `DefIdVisitor.
//   DefIdResult`): `LayoutOfHelpers.LayoutOfResult` / `FnAbiOfHelpers.FnAbiOfResult` are `MaybeResult` descriptors
//   (`MaybeResult_T` for `impl MaybeResult<T> for T`, `MaybeResult_Result` for `Result<T, E>`). The blanket
//   `impl<C: LayoutOfHelpers> LayoutOf for C` is `LayoutOf_provided`, installed on each implementor as forwarding
//   methods (`LayoutCx.layout_of(ty)`), and likewise `FnAbiOf_provided`.
// - `&'tcx LayoutError<'tcx>` is a `LayoutError` (`tcx.arena.alloc(err)` is `err`, PORTING §5).
// - `impl TyAbiInterface for Ty<'tcx>` is the table `TyAbiInterface_Ty`, registered with rustc_abi at load
//   (rustc_abi layout/ty.ts header); its generic `C: HasTyCtxt + HasTypingEnv` is `LayoutCxLike`.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import {
  AddressSpace,
  Align,
  type Float,
  FieldsShape,
  type HasDataLayout,
  Integer,
  LayoutCalculator,
  LayoutData,
  type PointeeInfo,
  type PointerKind,
  type Primitive,
  Primitive as PrimitiveC,
  ReprFlags,
  type ReprOptions,
  Scalar,
  Size,
  type TargetDataLayout,
  type TyAbiInterface,
  TyAndLayout as abi_TyAndLayout,
  type Layout,
  VariantIdx,
  FieldIdx,
  register_ty_abi_interface,
  type Variants,
  Variants_eq,
  debug_Align,
  debug_Size,
  debug_TyAndLayout,
  debug_Variants,
  IntegerType,
  Integer_discriminant,
} from "../../rustc_abi/lib.ts";
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { into_MultiSpan, type DiagArgValue, type PathBuf } from "../../rustc_error_messages/lib.ts";
import { String_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Level } from "../../rustc_errors/lib.ts";
import { Spanned_into_diag } from "../../rustc_errors/diagnostic.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span, debug_ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_Limit, display_Limit, Limit, Limit_mul } from "../../rustc_structures/limit.ts";
import type { Target, X86Abi } from "../../rustc_target/spec/mod.ts";
import { IsRigid, UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_struct, debug_tuple, type Fmt, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, assert_eq, panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { RecursionLimitReachedSizeSkeleton_diagnostic } from "../diagnostics.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../middle/codegen_fn_attrs.ts";
import { TyCtxtAt } from "../query/calls.ts";
import { TyCtxt } from "./context.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import type { AdtDef } from "./adt.ts";
import type { FnAbi, Instance, List } from "./decls.ts";
import { RawList } from "./list.ts";
import { Ty, TypingEnv } from "./mod.ts";
import { debug_NormalizationError, NormalizationError } from "./normalize_erasing_regions.ts";
import { debug_Ty, fold_Ty } from "./structural_impls.ts";

declare module "./context.ts" {
  interface TyCtxt {
    data_layout(): TargetDataLayout;
    target_spec(): Target;
    x86_abi_opt(): X86Abi;
    tcx_(): TyCtxt;
  }
}
declare module "../query/calls.ts" {
  interface TyCtxtAt {
    data_layout(): TargetDataLayout;
    target_spec(): Target;
    tcx_(): TyCtxt;
  }
}

/** `ty::print::pretty` (an extension module: read lazily, header). */
function pretty(): typeof import("./print/pretty.ts") {
  return (pretty__m ??= require("./print/pretty.ts") as typeof import("./print/pretty.ts"));
}
var pretty__m: typeof import("./print/pretty.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** `ty::sty` (an extension module: read lazily, header). */
function sty(): typeof import("./sty.ts") {
  return (sty__m ??= require("./sty.ts") as typeof import("./sty.ts"));
}
var sty__m: typeof import("./sty.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** `rustc_target::spec` (its module graph has init cycles: read lazily). */
function target_spec(): typeof import("../../rustc_target/spec/mod.ts") {
  return (target_spec__m ??= require("../../rustc_target/spec/mod.ts") as typeof import("../../rustc_target/spec/mod.ts"));
}
var target_spec__m: typeof import("../../rustc_target/spec/mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** `crate::traits` (reaches this module back through rustc_type_ir: read lazily, as ty/util.ts). */
function traits_mod(): typeof import("../traits/mod.ts") {
  return (traits_mod__m ??= require("../traits/mod.ts") as typeof import("../traits/mod.ts"));
}
var traits_mod__m: typeof import("../traits/mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** `{:?}` of a `Ty` / `TyAndLayout` / `LayoutError` (messages of `bug!` / `assert_eq!`; built only on failure). */
const dbg_TyAndLayout = (v: TyAndLayout): string => format_debug(v, debug_TyAndLayout_Ty, PLAIN);
const dbg_Variants = (v: Variants): string => format_debug(v, debug_Variants, PLAIN);
const dbg_int = (v: number): string => format_debug(v, debug_int, PLAIN);

/** `cmp::max` of two `abi::Integer`s (returns the second argument when equal, as `Ord::max`; the derived `Ord` is
 *  rustc_abi's `Integer_discriminant`). */
function Integer_max(a: Integer, b: Integer): Integer {
  return Integer_discriminant[b] >= Integer_discriminant[a] ? b : a;
}
const I128_MAX_U = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

// #[extension(pub trait IntegerExt)] impl abi::Integer
export const IntegerExt = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:31 to_ty
  to_ty(self: Integer, tcx: TyCtxt, signed: boolean): Ty {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (self) {
      case "I8":
        return signed ? tcx.types.i8 : tcx.types.u8;
      case "I16":
        return signed ? tcx.types.i16 : tcx.types.u16;
      case "I32":
        return signed ? tcx.types.i32 : tcx.types.u32;
      case "I64":
        return signed ? tcx.types.i64 : tcx.types.u64;
      case "I128":
        return signed ? tcx.types.i128 : tcx.types.u128;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:47 from_int_ty
  from_int_ty(cx: HasDataLayout, ity: IntTy): Integer {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (ity) {
      case "I8":
        return "I8";
      case "I16":
        return "I16";
      case "I32":
        return "I32";
      case "I64":
        return "I64";
      case "I128":
        return "I128";
      case "Isize":
        return cx.data_layout().ptr_sized_integer();
    }
  },
  // rustc: compiler/rustc_middle/src/ty/layout.rs:58 from_uint_ty
  from_uint_ty(cx: HasDataLayout, ity: UintTy): Integer {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (ity) {
      case "U8":
        return "I8";
      case "U16":
        return "I16";
      case "U32":
        return "I32";
      case "U64":
        return "I64";
      case "U128":
        return "I128";
      case "Usize":
        return cx.data_layout().ptr_sized_integer();
    }
  },

  /// Finds the appropriate Integer type and signedness for the given
  /// discriminant range and `#[repr]` attribute.
  ///
  /// To represent the way the values were written in the rust source, min and max
  /// are in different types. It's thus possible to pass in an unrepresentable range,
  /// and the method will panic in those cases.
  ///
  /// This is the basis for computing the type of the *tag* of an enum (which can be smaller than
  /// the type of the *discriminant*, which is determined by [`ReprOptions::discr_type`]).
  // PORT (layout-contract): `min_negative: i128` / `max_positive: u128` are `bigint`s.
  // rustc: compiler/rustc_middle/src/ty/layout.rs:79 discr_range_of_repr
  discr_range_of_repr(tcx: TyCtxt, ty: Ty, repr: ReprOptions, min_negative: bigint, max_positive: bigint): [Integer, boolean] {
    if (!(min_negative >= 0n || max_positive <= I128_MAX_U)) {
      panic(`No type can represent the full range of ${min_negative}..=${max_positive}`);
    }

    // Theoretically, negative values could be larger in unsigned representation
    // than the unsigned representation of the signed minimum. However, if there
    // are any negative values, the only valid unsigned representation is u128
    // which can fit all i128 values, so the result remains unaffected.
    const min_negative_u = BigInt.asUintN(128, min_negative);
    const unsigned_fit = Integer.fit_unsigned(min_negative_u > max_positive ? min_negative_u : max_positive);
    const signed_fit = Integer_max(Integer.fit_signed(min_negative), Integer.fit_signed(BigInt.asIntN(128, max_positive)));

    const ity = repr.int;
    if (ity !== undefined) {
      const discr = Integer.from_attr(tcx, ity);
      const fit = IntegerType.is_signed(ity) ? signed_fit : unsigned_fit;
      if (Integer_discriminant[discr] < Integer_discriminant[fit]) {
        bug(`Integer::repr_discr: \`#[repr]\` hint too small for discriminant range of enum \`${pretty().display_Ty(ty)}\``);
      }
      return [discr, IntegerType.is_signed(ity)];
    }

    let at_least: Integer;
    if (repr.c()) {
      // This is usually I32, however it can be different on some platforms,
      // notably hexagon and arm-none/thumb-none
      at_least = tcx.data_layout().c_enum_min_size;
    } else {
      // repr(Rust) enums try to be as small as possible
      at_least = "I8";
    }

    // Pick the smallest fit. Prefer unsigned; that matches clang in cases where this makes a
    // difference (https://godbolt.org/z/h4xEasW1d) so it is crucial for repr(C).
    if (Integer_discriminant[unsigned_fit] <= Integer_discriminant[signed_fit]) {
      return [Integer_max(unsigned_fit, at_least), false];
    } else {
      return [Integer_max(signed_fit, at_least), true];
    }
  },
};

// #[extension(pub trait FloatExt)] impl abi::Float
export const FloatExt = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:137 to_ty
  to_ty(self: Float, tcx: TyCtxt): Ty {
    // use abi::Float::*;
    switch (self) {
      case "F16":
        return tcx.types.f16;
      case "F16B":
        return Ty.new_adt(tcx, tcx.adt_def(tcx.require_lang_item(LangItem.F16B, DUMMY_SP)) as AdtDef, RawList.empty());
      case "F32":
        return tcx.types.f32;
      case "F64":
        return tcx.types.f64;
      case "F128":
        return tcx.types.f128;
      case "PpcF128":
        return Ty.new_adt(tcx, tcx.adt_def(tcx.require_lang_item(LangItem.PpcF128, DUMMY_SP)) as AdtDef, RawList.empty());
    }
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:157 from_float_ty
  from_float_ty(fty: FloatTy): Float {
    // use abi::Float::*;
    switch (fty) {
      case "F16":
        return "F16";
      case "F32":
        return "F32";
      case "F64":
        return "F64";
      case "F128":
        return "F128";
    }
  },
};

// #[extension(pub trait PrimitiveExt)] impl Primitive
export const PrimitiveExt = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:171 to_ty
  to_ty(self: Primitive, tcx: TyCtxt): Ty {
    switch (self.$) {
      case "Int": {
        const [i, signed] = [self._0, self._1];
        return IntegerExt.to_ty(i, tcx, signed);
      }
      case "Float":
        return FloatExt.to_ty(self._0, tcx);
      // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
      case "Pointer":
        return Ty.new_mut_ptr(tcx, tcx.types.unit);
    }
  },

  /// Return an *integer* type matching this primitive.
  /// Useful in particular when dealing with enum discriminants.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:183 to_int_ty
  to_int_ty(self: Primitive, tcx: TyCtxt): Ty {
    switch (self.$) {
      case "Int": {
        const [i, signed] = [self._0, self._1];
        return IntegerExt.to_ty(i, tcx, signed);
      }
      // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
      case "Pointer": {
        const signed = false;
        return IntegerExt.to_ty(tcx.data_layout().ptr_sized_integer(), tcx, signed);
      }
      case "Float":
        return bug("floats do not have an int type");
    }
  },
};

/// The first half of a wide pointer.
///
/// - For a trait object, this is the address of the box.
/// - For a slice, this is the base address.
export const WIDE_PTR_ADDR: number = 0;

/// The second half of a wide pointer.
///
/// - For a trait object, this is the address of the vtable.
/// - For a slice, this is the length.
export const WIDE_PTR_EXTRA: number = 1;

/// Used in `check_validity_requirement` to indicate the kind of initialization
/// that is checked to be valid
// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, StableHash)]
export type ValidityRequirement =
  | "Inhabited"
  | "Zero"
  /// The return value of mem::uninitialized, 0x01
  /// (unless -Zstrict-init-checks is on, in which case it's the same as Uninit).
  | "UninitMitigated0x01Fill"
  /// True uninitialized memory.
  | "Uninit";
export const ValidityRequirement = {
  Inhabited: "Inhabited",
  Zero: "Zero",
  UninitMitigated0x01Fill: "UninitMitigated0x01Fill",
  Uninit: "Uninit",

  // rustc: compiler/rustc_middle/src/ty/layout.rs:222 from_intrinsic
  from_intrinsic(intrinsic: Symbol): ValidityRequirement | undefined {
    switch (intrinsic) {
      case sym.assert_inhabited:
        return "Inhabited";
      case sym.assert_zero_valid:
        return "Zero";
      case sym.assert_mem_uninitialized_valid:
        return "UninitMitigated0x01Fill";
      default:
        return undefined;
    }
  },
} as const;
// derive(Debug)
export const debug_ValidityRequirement: Debug<ValidityRequirement> = (v) => v;
// impl fmt::Display for ValidityRequirement
// rustc: compiler/rustc_middle/src/ty/layout.rs:233 fmt
export function display_ValidityRequirement(self: ValidityRequirement): string {
  switch (self) {
    case "Inhabited":
      return "is inhabited";
    case "Zero":
      return "allows being left zeroed";
    case "UninitMitigated0x01Fill":
      return "allows being filled with 0x01";
    case "Uninit":
      return "allows being left uninitialized";
  }
}

// #[derive(Copy, Clone, Debug, StableHash, TyEncodable, TyDecodable)]
export type SimdLayoutError =
  /// The vector has 0 lanes.
  | { readonly $: "ZeroLength" }
  /// The vector has more lanes than supported or permitted by
  /// #\[rustc_simd_monomorphize_lane_limit\].
  | { readonly $: "TooManyLanes"; readonly _0: Limit };
export const SimdLayoutError = {
  ZeroLength: Object.freeze({ $: "ZeroLength" }) as SimdLayoutError,
} as const;
// derive(Debug)
export const debug_SimdLayoutError: Debug<SimdLayoutError> = (v, f) => {
  switch (v.$) {
    case "ZeroLength":
      return "ZeroLength";
    case "TooManyLanes":
      return debug_tuple(f, "TooManyLanes", [debug_Limit(v._0, f)]);
  }
};

// #[derive(Copy, Clone, Debug, StableHash, TyEncodable, TyDecodable)]
export type LayoutError =
  /// A type doesn't have a sensible layout.
  ///
  /// This variant is used for layout errors that don't necessarily cause
  /// compile errors.
  ///
  /// For example, this can happen if a struct contains an unsized type in a
  /// non-tail field, but has an unsatisfiable bound like `str: Sized`.
  | { readonly $: "Unknown"; readonly _0: Ty }
  /// The size of a type exceeds [`TargetDataLayout::obj_size_bound`].
  | { readonly $: "SizeOverflow"; readonly _0: Ty }
  /// A SIMD vector has invalid layout, such as zero-length or too many lanes.
  | { readonly $: "InvalidSimd"; readonly ty: Ty; readonly kind: SimdLayoutError }
  /// The layout can vary due to a generic parameter.
  ///
  /// Unlike `Unknown`, this variant is a "soft" error and indicates that the layout
  /// may become computable after further instantiating the generic parameter(s).
  | { readonly $: "TooGeneric"; readonly _0: Ty }
  /// An alias failed to normalize.
  ///
  /// This variant is necessary, because, due to trait solver incompleteness, it is
  /// possible than an alias that was rigid during analysis fails to normalize after
  /// revealing opaque types.
  ///
  /// See `tests/ui/layout/normalization-failure.rs` for an example.
  | { readonly $: "NormalizationFailure"; readonly _0: Ty; readonly _1: NormalizationError }
  /// A non-layout error is reported elsewhere.
  | { readonly $: "ReferencesError"; readonly _0: ErrorGuaranteed };
// derive(Debug)
export const debug_LayoutError: Debug<LayoutError> = (v, f) => {
  switch (v.$) {
    case "Unknown":
      return debug_tuple(f, "Unknown", [debug_Ty(v._0, f)]);
    case "SizeOverflow":
      return debug_tuple(f, "SizeOverflow", [debug_Ty(v._0, f)]);
    case "InvalidSimd":
      return debug_struct(f, "InvalidSimd", [
        ["ty", debug_Ty(v.ty, f)],
        ["kind", debug_SimdLayoutError(v.kind, f)],
      ]);
    case "TooGeneric":
      return debug_tuple(f, "TooGeneric", [debug_Ty(v._0, f)]);
    case "NormalizationFailure":
      return debug_tuple(f, "NormalizationFailure", [debug_Ty(v._0, f), debug_NormalizationError(v._1, f)]);
    case "ReferencesError":
      return debug_tuple(f, "ReferencesError", [debug_ErrorGuaranteed(v._0, f)]);
  }
};

// impl<'tcx> fmt::Display for LayoutError<'tcx>
// rustc: compiler/rustc_middle/src/ty/layout.rs:284 fmt
export function display_LayoutError(self: LayoutError): string {
  const display_Ty = pretty().display_Ty;
  switch (self.$) {
    case "Unknown":
      return `the type \`${display_Ty(self._0)}\` has an unknown layout`;
    case "TooGeneric":
      return `the type \`${display_Ty(self._0)}\` does not have a fixed layout`;
    case "SizeOverflow":
      return `values of the type \`${display_Ty(self._0)}\` are too big for the target architecture`;
    case "InvalidSimd": {
      const { ty, kind } = self;
      if (kind.$ === "TooManyLanes") {
        const max_lanes = kind._0;
        return `the SIMD type \`${display_Ty(ty)}\` has more elements than the limit ${display_Limit(max_lanes)}`;
      }
      return `the SIMD type \`${display_Ty(ty)}\` has zero elements`;
    }
    case "NormalizationFailure": {
      const [t, e] = [self._0, self._1];
      return `unable to determine layout for \`${display_Ty(t)}\` because \`${NormalizationError.get_type_for_failure(e)}\` cannot be normalized`;
    }
    case "ReferencesError":
      return "the type has an unknown layout";
  }
}

// impl<'tcx> IntoDiagArg for LayoutError<'tcx>
// rustc: compiler/rustc_middle/src/ty/layout.rs:311 into_diag_arg
export function LayoutError_into_diag_arg(self: LayoutError, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_LayoutError(self), { value: undefined });
}

// #[derive(Clone, Copy)]
// PORT (layout-contract): the impls of `HasTypingEnv` / `HasDataLayout` / `HasTargetSpec` / `HasX86AbiOpt` /
// `HasTyCtxt` / `LayoutOfHelpers` (and the blanket `LayoutOf`) for `LayoutCx` are methods of the class, in the body
// (PORTING §8). The field `typing_env` keeps its name; the trait method is `typing_env_()` (header).
export class LayoutCx implements LayoutOf<Result<TyAndLayout, LayoutError>, LayoutError> {
  constructor(
    public calc: LayoutCalculator<TyCtxt>,
    public typing_env: TypingEnv,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/layout.rs:323 new
  static new(tcx: TyCtxt, typing_env: TypingEnv): LayoutCx {
    return new LayoutCx(LayoutCalculator.new(tcx), typing_env);
  }

  // impl<'tcx> HasTypingEnv<'tcx> for LayoutCx<'tcx>
  // rustc: compiler/rustc_middle/src/ty/layout.rs:670 typing_env
  typing_env_(): TypingEnv {
    return this.typing_env;
  }

  // impl<'tcx> HasDataLayout for LayoutCx<'tcx>
  // rustc: compiler/rustc_middle/src/ty/layout.rs:676 data_layout
  data_layout(): TargetDataLayout {
    return this.calc.cx.data_layout();
  }

  // impl<'tcx> HasTargetSpec for LayoutCx<'tcx>
  // rustc: compiler/rustc_middle/src/ty/layout.rs:682 target_spec
  target_spec(): Target {
    return this.calc.cx.target_spec();
  }

  // impl<'tcx> HasX86AbiOpt for LayoutCx<'tcx>
  // rustc: compiler/rustc_middle/src/ty/layout.rs:688 x86_abi_opt
  x86_abi_opt(): X86Abi {
    return this.calc.cx.x86_abi_opt();
  }

  // impl<'tcx> HasTyCtxt<'tcx> for LayoutCx<'tcx>
  // rustc: compiler/rustc_middle/src/ty/layout.rs:694 tcx
  tcx_(): TyCtxt {
    return this.calc.cx;
  }

  // ---- impl<'tcx> LayoutOfHelpers<'tcx> for LayoutCx<'tcx> ----
  // type LayoutOfResult = Result<TyAndLayout<'tcx>, &'tcx LayoutError<'tcx>>;
  get LayoutOfResult(): MaybeResult<TyAndLayout, Result<TyAndLayout, LayoutError>, LayoutError> {
    return MaybeResult_Result;
  }

  // (provided) ty/layout.rs:740 layout_tcx_at_span -> LayoutOfHelpers_provided.layout_tcx_at_span
  layout_tcx_at_span(): Span {
    return LayoutOfHelpers_provided.layout_tcx_at_span(this);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:790 handle_layout_err
  handle_layout_err(err: LayoutError, _: Span, __: Ty): LayoutError {
    return /* self.tcx().arena.alloc( */ err;
  }

  // ---- impl<'tcx, C: LayoutOfHelpers<'tcx>> LayoutOf<'tcx> for C {} ----
  // (provided) ty/layout.rs:764 layout_of -> LayoutOf_provided.layout_of
  layout_of(ty: Ty): Result<TyAndLayout, LayoutError> {
    return LayoutOf_provided.layout_of(this, ty);
  }
  // (provided) ty/layout.rs:773 spanned_layout_of -> LayoutOf_provided.spanned_layout_of
  spanned_layout_of(ty: Ty, span: Span): Result<TyAndLayout, LayoutError> {
    return LayoutOf_provided.spanned_layout_of(this, ty, span);
  }
}

/// Type size "skeleton", i.e., the only information determining a type's size.
/// While this is conservative, (aside from constant sizes, only pointers,
/// newtypes thereof and null pointer optimized enums are allowed), it is
/// enough to statically check common use cases of transmute.
// #[derive(Copy, Clone, Debug)]
export type SizeSkeleton =
  /// Any statically computable Layout.
  /// Alignment can be `None` if unknown.
  | { readonly $: "Known"; readonly _0: Size; readonly _1: Align | undefined }

  /// A potentially-wide pointer.
  | {
      readonly $: "Pointer";
      /// If true, this pointer is never null.
      readonly non_zero: boolean;
      /// The type which determines the unsized metadata, if any,
      /// of this pointer. Either a type parameter or a projection
      /// depending on one, with regions erased.
      readonly tail: Ty;
    };
export const SizeSkeleton = {
  // rustc: compiler/rustc_middle/src/ty/layout.rs:350 compute
  compute(ty: Ty, tcx: TyCtxt, typing_env: TypingEnv, span: Span): Result<SizeSkeleton, LayoutError> {
    return SizeSkeleton.compute_inner(ty, tcx, typing_env, span, 0);
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:359 compute_inner
  compute_inner(ty: Ty, tcx: TyCtxt, typing_env: TypingEnv, span: Span, depth: number): Result<SizeSkeleton, LayoutError> {
    // debug_assert!(!ty.has_non_region_infer());

    // Bail out if we've recursed too deeply (issue #156137); a cyclic type
    // alias can otherwise blow the stack here. Using `>=` rather than `>`
    // means we fire exactly at the limit, which lets us report the
    // cycle-root type (`Thing<T>`) instead of an innocent field type.
    const recursion_limit = tcx.recursion_limit();
    if (depth >= recursion_limit._0) {
      const suggested_limit = recursion_limit._0 === 0 ? Limit.new(2) : Limit_mul(recursion_limit, 2);
      const reported = tcx.dcx().emit_err(
        RecursionLimitReachedSizeSkeleton_diagnostic({
          span,
          ty,
          suggested_limit,
        }),
      );
      return Err(/* tcx.arena.alloc( */ { $: "ReferencesError", _0: reported });
    }

    // First try computing a static layout.
    let err: LayoutError;
    const layout_r = tcx.layout_of(typing_env.as_query_input(ty));
    if (layout_r.$ === "Ok") {
      const layout = layout_r._0;
      if (layout.is_sized()) {
        return Ok({ $: "Known", _0: layout.size, _1: layout.align.abi });
      } else {
        // Just to be safe, don't claim a known layout for unsized types.
        return Err({ $: "Unknown", _0: ty });
      }
    } else {
      const e = layout_r._0;
      switch (e.$) {
        case "TooGeneric":
          err = e;
          break;
        // We can't extract SizeSkeleton info from other layout errors
        case "Unknown":
        case "SizeOverflow":
        case "InvalidSimd":
        case "NormalizationFailure":
        case "ReferencesError":
          return Err(e);
      }
    }

    const k = ty.kind();
    switch (k.$) {
      case "Ref":
      case "RawPtr": {
        const pointee = k.$ === "Ref" ? k._1 : k._0;
        const non_zero = !ty.is_raw_ptr();

        tcx.assert_fully_normalized(typing_env, pointee, fold_Ty);
        const tail = tcx.struct_tail_raw(
          pointee,
          traits_mod().ObligationCause.dummy(),
          (ty) => {
            const r = tcx.try_normalize_erasing_regions(typing_env, ty, fold_Ty);
            if (r.$ === "Ok") {
              return r._0;
            } else {
              return Ty.new_error_with_message(
                tcx,
                into_MultiSpan(DUMMY_SP),
                `normalization failed for ${NormalizationError.get_type_for_failure(r._0)} but no errors reported`,
              );
            }
          },
          () => {},
        );

        const tk = tail.kind();
        // FIXME(#155345): This should only handle rigid aliases if we're using
        // the new solver.
        if (tk.$ === "Param" || (tk.$ === "Alias" && (tk._1.kind.$ === "Projection" || tk._1.kind.$ === "Inherent"))) {
          // debug_assert!(tail.has_non_region_param());
          return Ok({
            $: "Pointer",
            non_zero,
            tail: tcx.erase_and_anonymize_regions(tail, fold_Ty),
          });
        } else if (tk.$ === "Error") {
          // Fixes ICE #124031
          return Err({ $: "ReferencesError", _0: tk._0 });
        } else {
          return bug(
            `SizeSkeleton::compute(${pretty().display_Ty(ty)}): layout errored (${format_debug(err, debug_LayoutError, PLAIN)}), yet tail \`${pretty().display_Ty(tail)}\` is not a type parameter or a projection`,
          );
        }
      }
      case "Array": {
        if (!tcx.features().transmute_generic_consts()) {
          return Err(err);
        }
        const [inner, len] = [k._0, k._1];
        const len_eval = len.try_to_target_usize(tcx);
        if (len_eval === 0) {
          return Ok({ $: "Known", _0: Size.from_bytes(0), _1: undefined });
        }

        const inner_r = SizeSkeleton.compute_inner(inner, tcx, typing_env, span, depth + 1);
        if (inner_r.$ === "Err") return inner_r;
        const inner_sk = inner_r._0;
        switch (inner_sk.$) {
          // This may succeed because the multiplication of two types may overflow
          // but a single size of a nested array will not.
          case "Known": {
            const [s, a] = [inner_sk._0, inner_sk._1];
            if (len_eval !== undefined) {
              const c = len_eval;
              // PORT: `u64::checked_mul` in `bigint`; a product of 2^64 or more is `None` as upstream.
              const size = BigInt(s.bytes()) * BigInt(c);
              if (size > U64_MAX) return Err({ $: "SizeOverflow", _0: ty });
              // PORT: `Size` is a `number` (root decision): a byte count past 2^53 stops instead of losing precision.
              if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
                return unported("Size beyond 2^53 (rustc_middle::ty::layout::SizeSkeleton::compute_inner, array)");
              }
              // Alignment is unchanged by arrays.
              return Ok({ $: "Known", _0: Size.from_bytes(Number(size)), _1: a });
            }
            return Err(err);
          }
          case "Pointer":
            return Err(err);
        }
        break;
      }

      case "Adt": {
        const [def, args] = [k._0, k._1];
        // Only newtypes and enums w/ nullable pointer optimization (NPO).
        if (def.is_union() || def.variants().length === 0 || def.variants().length > 2) {
          return Err(err);
        }
        // Only default repr types.
        {
          // We can ignore the seed and some particular flags that can never affect the
          // layout of newtypes / NPO types, but we have to check everything else.
          // If you are adding a new field to `ReprOptions`, make sure to extend the check
          // below so that we bail out if it is not at its default value!
          const { int, align, pack, flags, scalable } = def.repr();
          let ignored_flags = ReprFlags.union(
            ReprFlags.union(ReprFlags.IS_TRANSPARENT, ReprFlags.IS_LINEAR),
            ReprFlags.RANDOMIZE_LAYOUT,
          );
          if (def.is_struct()) {
            // `repr(C)` is only okay for structs, not for enums.
            // Below, the *only* thing we do for structs is propagating
            // `SizeSkeleton::Pointer`. We do *not* assume that `repr(C)` preserved
            // ZST-ness (which might stop being true eventually).
            ignored_flags = ReprFlags.union(ignored_flags, ReprFlags.IS_C);
          }
          if (
            int !== undefined ||
            align !== undefined ||
            pack !== undefined ||
            ReprFlags.difference(flags, ignored_flags) !== ReprFlags.empty() ||
            scalable !== undefined
          ) {
            return Err(err);
          }
        }

        // Get a zero-sized variant or a pointer newtype.
        // Returns `Ok(None)` for 1-ZST types, `Ok(Some)` if (ignoring all 1-ZST fields)
        // there's just a single pointer, and `Err` otherwise.
        // PORT: the lazy `fields` iterator is the loop body (each field is computed only when reached).
        const zero_or_ptr_variant = (i_: number): Result<SizeSkeleton | undefined, LayoutError> => {
          const i = VariantIdx.from_usize(i_);
          let ptr: SizeSkeleton | undefined = undefined;
          for (const field_def of def.variant(i).fields) {
            const field_r = SizeSkeleton.compute_inner(
              Unnormalized.skip_norm_wip(field_def.ty(tcx, args)),
              tcx,
              typing_env,
              span,
              depth + 1,
            );
            if (field_r.$ === "Err") return field_r;
            const field = field_r._0;
            switch (field.$) {
              case "Known": {
                const [size, align] = [field._0, field._1];
                const is_1zst = size.bytes() === 0 && align !== undefined && align.bytes() === 1;
                if (!is_1zst) {
                  return Err(err);
                }
                break;
              }
              case "Pointer": {
                if (ptr !== undefined) {
                  return Err(err);
                }
                ptr = field;
                break;
              }
            }
          }
          return Ok(ptr);
        };

        const v0_r = zero_or_ptr_variant(0);
        if (v0_r.$ === "Err") return v0_r;
        const v0 = v0_r._0;
        // Single-variant case: Check if this is a newtype around a pointer.
        // Such types are themselves pointer-sized.
        if (def.variants().length === 1) {
          if (v0 !== undefined && v0.$ === "Pointer") {
            const { non_zero, tail } = v0;
            return Ok({ $: "Pointer", non_zero, tail });
          } else {
            return Err(err);
          }
        }

        const v1_r = zero_or_ptr_variant(1);
        if (v1_r.$ === "Err") return v1_r;
        const v1 = v1_r._0;
        // 2-variant case: Check if one variant is a *non-zero* pointer and the other a
        // 1-ZST. Such types are eligible to for the nullable pointer enum optimization, so
        // they are themselves pointer-sized.
        if (v0 !== undefined && v0.$ === "Pointer" && v0.non_zero === true && v1 === undefined) {
          return Ok({ $: "Pointer", non_zero: false, tail: v0.tail });
        } else if (v0 === undefined && v1 !== undefined && v1.$ === "Pointer" && v1.non_zero === true) {
          return Ok({ $: "Pointer", non_zero: false, tail: v1.tail });
        } else {
          return Err(err);
        }
      }

      case "Alias": {
        const normalized = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
        if (ty === normalized) {
          return Err(err);
        } else {
          return SizeSkeleton.compute_inner(normalized, tcx, typing_env, span, depth + 1);
        }
      }

      case "Pat": {
        const [base_ty, pat] = [k._0, k._1];
        // Pattern types are always the same size as their base.
        const base = SizeSkeleton.compute_inner(base_ty, tcx, typing_env, span, depth + 1);
        const pk = pat.kind();
        switch (pk.$) {
          case "Range":
          case "Or":
            return base;
          // But in the case of `!null` patterns we need to note that in the
          // raw pointer.
          case "NotNull": {
            if (base.$ === "Err") return base;
            const b = base._0;
            switch (b.$) {
              case "Known":
                return base;
              case "Pointer":
                return Ok({ $: "Pointer", non_zero: true, tail: b.tail });
            }
          }
        }
        break;
      }

      default:
        return Err(err);
    }
    return unreachable();
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:601 same_size
  same_size(self: SizeSkeleton, other: SizeSkeleton): boolean {
    // PORT: `Size`'s derived `PartialEq` compares the byte count.
    if (self.$ === "Known" && other.$ === "Known") {
      const [a, b] = [self._0, other._0];
      return a.bytes() === b.bytes();
    } else if (self.$ === "Pointer" && other.$ === "Pointer") {
      const [a, b] = [self.tail, other.tail];
      return a === b;
    } else {
      return false;
    }
  },
} as const;
// derive(Debug)
export const debug_SizeSkeleton: Debug<SizeSkeleton> = (v, f) => {
  switch (v.$) {
    case "Known":
      return debug_tuple(f, "Known", [debug_Size(v._0, f), debug_option(v._1, f, debug_Align)]);
    case "Pointer":
      return debug_struct(f, "Pointer", [
        ["non_zero", debug_bool(v.non_zero, f)],
        ["tail", debug_Ty(v.tail, f)],
      ]);
  }
};

// pub trait HasTyCtxt<'tcx>: HasDataLayout
export interface HasTyCtxt extends HasDataLayout {
  // PORT (layout-contract): `tcx()` is `tcx_()` (header).
  // rustc: compiler/rustc_middle/src/ty/layout.rs:613 tcx
  tcx_(): TyCtxt;
}

// pub trait HasTypingEnv<'tcx>
export interface HasTypingEnv {
  // PORT (layout-contract): `typing_env()` is `typing_env_()` (header).
  // rustc: compiler/rustc_middle/src/ty/layout.rs:617 typing_env
  typing_env_(): TypingEnv;
}

// impl<'tcx> HasDataLayout for TyCtxt<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/ty/layout.rs:622 data_layout
TyCtxt.prototype.data_layout = function (this: TyCtxt): TargetDataLayout {
  return this.gcx.data_layout;
};

// impl<'tcx> HasTargetSpec for TyCtxt<'tcx>
// rustc: compiler/rustc_middle/src/ty/layout.rs:628 target_spec
TyCtxt.prototype.target_spec = function (this: TyCtxt): Target {
  return this.sess.target;
};

// impl<'tcx> HasX86AbiOpt for TyCtxt<'tcx>
// rustc: compiler/rustc_middle/src/ty/layout.rs:634 x86_abi_opt
TyCtxt.prototype.x86_abi_opt = function (this: TyCtxt): X86Abi {
  return {
    regparm: this.sess.opts.unstable_opts.regparm,
    reg_struct_return: this.sess.opts.unstable_opts.reg_struct_return,
  };
};

// impl<'tcx> HasTyCtxt<'tcx> for TyCtxt<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/ty/layout.rs:644 tcx
TyCtxt.prototype.tcx_ = function (this: TyCtxt): TyCtxt {
  return this;
};

// impl<'tcx> HasDataLayout for TyCtxtAt<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/ty/layout.rs:651 data_layout
TyCtxtAt.prototype.data_layout = function (this: TyCtxtAt): TargetDataLayout {
  return this.tcx.gcx.data_layout;
};

// impl<'tcx> HasTargetSpec for TyCtxtAt<'tcx>
// rustc: compiler/rustc_middle/src/ty/layout.rs:657 target_spec
TyCtxtAt.prototype.target_spec = function (this: TyCtxtAt): Target {
  return this.tcx.sess.target;
};

// impl<'tcx> HasTyCtxt<'tcx> for TyCtxtAt<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/ty/layout.rs:664 tcx
TyCtxtAt.prototype.tcx_ = function (this: TyCtxtAt): TyCtxt {
  return this.deref();
};

// pub trait MaybeResult<T> { type Error; .. }
// PORT (layout-contract): the impl descriptor of `Self: MaybeResult<T>` with `type Error = E` (header).
export interface MaybeResult<T, Self, E> {
  // rustc: compiler/rustc_middle/src/ty/layout.rs:702 from
  from(x: Result<T, E>): Self;
  // rustc: compiler/rustc_middle/src/ty/layout.rs:703 to_result
  to_result(self: Self): Result<T, E>;
}

// impl<T> MaybeResult<T> for T { type Error = !; }
export const MaybeResult_T = {
  // PORT (layout-contract): the parameter pattern `Ok(x)` is irrefutable (`Self::Error = !`).
  // rustc: compiler/rustc_middle/src/ty/layout.rs:709 from
  from<T>(x: Result<T, never>): T {
    if (x.$ === "Err") return unreachable();
    return x._0;
  },
  // rustc: compiler/rustc_middle/src/ty/layout.rs:712 to_result
  to_result<T>(self: T): Result<T, never> {
    return { $: "Ok", _0: self };
  },
};

// impl<T, E> MaybeResult<T> for Result<T, E> { type Error = E; }
export const MaybeResult_Result = {
  // rustc: compiler/rustc_middle/src/ty/layout.rs:720 from
  from<T, E>(x: Result<T, E>): Result<T, E> {
    return x;
  },
  // rustc: compiler/rustc_middle/src/ty/layout.rs:723 to_result
  to_result<T, E>(self: Result<T, E>): Result<T, E> {
    return self;
  },
};

export type TyAndLayout = abi_TyAndLayout<Ty>;
/** `<TyAndLayout<'tcx> as Debug>` (rustc_abi's impl with `Ty: Display`). */
export const debug_TyAndLayout_Ty: Debug<TyAndLayout> = (v, f) => debug_TyAndLayout(v, f, (ty) => pretty().display_Ty(ty));

/// Trait for contexts that want to be able to compute layouts of types.
/// This automatically gives access to `LayoutOf`, through a blanket `impl`.
// pub trait LayoutOfHelpers<'tcx>: HasDataLayout + HasTyCtxt<'tcx> + HasTypingEnv<'tcx>
// PORT (layout-contract): `R` is `Self::LayoutOfResult`, `E` its `MaybeResult::Error` (header).
export interface LayoutOfHelpers<R, E> extends HasDataLayout, HasTyCtxt, HasTypingEnv {
  /// The `TyAndLayout`-wrapping type (or `TyAndLayout` itself), which will be
  /// returned from `layout_of` (see also `handle_layout_err`).
  // type LayoutOfResult: MaybeResult<TyAndLayout<'tcx>> = TyAndLayout<'tcx>;
  readonly LayoutOfResult: MaybeResult<TyAndLayout, R, E>;

  /// `Span` to use for `tcx.at(span)`, from `layout_of`.
  // FIXME(eddyb) perhaps make this mandatory to get contexts to track it better?
  // #[inline]
  // (provided) ty/layout.rs:740 layout_tcx_at_span -> LayoutOfHelpers_provided.layout_tcx_at_span
  layout_tcx_at_span(): Span;

  /// Helper used for `layout_of`, to adapt `tcx.layout_of(...)` into a
  /// `Self::LayoutOfResult` (which does not need to be a `Result<...>`).
  ///
  /// Most `impl`s, which propagate `LayoutError`s, should simply return `err`,
  /// but this hook allows e.g. codegen to return only `TyAndLayout` from its
  /// `cx.layout_of(...)`, without any `Result<...>` around it to deal with
  /// (and any `LayoutError`s are turned into fatal errors or ICEs).
  // rustc: compiler/rustc_middle/src/ty/layout.rs:751 handle_layout_err
  handle_layout_err(err: LayoutError, span: Span, ty: Ty): E;
}

/** PORT: the provided methods of `LayoutOfHelpers` (PORTING §8). */
export const LayoutOfHelpers_provided = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:740 layout_tcx_at_span
  layout_tcx_at_span<R, E>(_self: LayoutOfHelpers<R, E>): Span {
    return DUMMY_SP;
  },
};

/// Blanket extension trait for contexts that can compute layouts of types.
// pub trait LayoutOf<'tcx>: LayoutOfHelpers<'tcx>
export interface LayoutOf<R, E> extends LayoutOfHelpers<R, E> {
  /// Computes the layout of a type. Note that this implicitly
  /// executes in `TypingMode::PostAnalysis`, and will normalize the input type.
  // (provided) ty/layout.rs:764 layout_of -> LayoutOf_provided.layout_of
  layout_of(ty: Ty): R;

  /// Computes the layout of a type, at `span`. Note that this implicitly
  /// executes in `TypingMode::PostAnalysis`, and will normalize the input type.
  // (provided) ty/layout.rs:773 spanned_layout_of -> LayoutOf_provided.spanned_layout_of
  spanned_layout_of(ty: Ty, span: Span): R;
}

/** PORT: the provided methods of `LayoutOf` (the blanket `impl<C: LayoutOfHelpers> LayoutOf for C`, header). */
export const LayoutOf_provided = {
  /// Computes the layout of a type. Note that this implicitly
  /// executes in `TypingMode::PostAnalysis`, and will normalize the input type.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:764 layout_of
  layout_of<R, E>(self: LayoutOfHelpers<R, E>, ty: Ty): R {
    return LayoutOf_provided.spanned_layout_of(self, ty, DUMMY_SP);
  },

  /// Computes the layout of a type, at `span`. Note that this implicitly
  /// executes in `TypingMode::PostAnalysis`, and will normalize the input type.
  // FIXME(eddyb) avoid passing information like this, and instead add more
  // `TyCtxt::at`-like APIs to be able to do e.g. `cx.at(span).layout_of(ty)`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:773 spanned_layout_of
  spanned_layout_of<R, E>(self: LayoutOfHelpers<R, E>, ty: Ty, span: Span): R {
    span = !Span.is_dummy(span) ? span : self.layout_tcx_at_span();
    const tcx = self.tcx_().at(span);

    const r = tcx.layout_of(self.typing_env_().as_query_input(ty));
    return self.LayoutOfResult.from(r.$ === "Err" ? Err(self.handle_layout_err(r._0, span, ty)) : r);
  },
};

/** `C: HasTyCtxt<'tcx> + HasTypingEnv<'tcx>` (the `cx` of `impl TyAbiInterface for Ty`). */
export type LayoutCxLike = HasTyCtxt & HasTypingEnv;

/** The local `enum TyMaybeWithLayout` of `ty_and_layout_field` (ty/layout.rs:849). */
export type TyMaybeWithLayout = { readonly $: "Ty"; readonly _0: Ty } | { readonly $: "TyAndLayout"; readonly _0: TyAndLayout };

// impl<'tcx, C> TyAbiInterface<'tcx, C> for Ty<'tcx> where C: HasTyCtxt<'tcx> + HasTypingEnv<'tcx>
// PORT (layout-contract): the impl table, registered with rustc_abi below (header).
export const TyAbiInterface_Ty: TyAbiInterface<Ty, LayoutCxLike> = {
  // rustc: compiler/rustc_middle/src/ty/layout.rs:804 ty_and_layout_for_variant
  ty_and_layout_for_variant(this_: TyAndLayout, cx: LayoutCxLike, variant_index: VariantIdx): TyAndLayout {
    let layout: Layout;
    const v = this_.variants;
    if (v.$ === "Single" && v.index === variant_index) {
      // If all variants but one are uninhabited, the variant layout is the enum layout.
      return this_;
    } else if (v.$ === "Single" || v.$ === "Empty") {
      // Single-variant and no-variant enums *can* have other variants, but those are
      // uninhabited. Produce a layout that has the right fields for that variant, so that
      // the rest of the compiler can project fields etc as usual.

      const tcx = cx.tcx_();
      const typing_env = cx.typing_env_();

      // Deny calling for_variant more than once for non-Single enums.
      const original_r = tcx.layout_of(typing_env.as_query_input(this_.ty));
      if (original_r.$ === "Ok") {
        const original_layout = original_r._0;
        assert_eq(original_layout.variants, this_.variants, dbg_Variants, Variants_eq);
      }

      let fields: number;
      const k = this_.ty.kind();
      if (k.$ === "Adt" && k._0.variants().length === 0) {
        return bug(`for_variant called on zero-variant enum ${pretty().display_Ty(this_.ty)}`);
      } else if (k.$ === "Adt") {
        fields = k._0.variant(variant_index).fields.length;
      } else {
        return bug(`\`ty_and_layout_for_variant\` on unexpected type ${pretty().display_Ty(this_.ty)}`);
      }
      layout = tcx.mk_layout(LayoutData.uninhabited_variant(cx, variant_index, fields));
    } else {
      layout = cx.tcx_().mk_layout(LayoutData.for_variant(this_.deref(), variant_index));
    }

    assert_eq(layout.variants(), { $: "Single", index: variant_index }, dbg_Variants, Variants_eq);

    return new abi_TyAndLayout(this_.ty, layout);
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:848 ty_and_layout_field
  ty_and_layout_field(this_: TyAndLayout, cx: LayoutCxLike, i: number): TyAndLayout {
    // enum TyMaybeWithLayout<'tcx> { Ty(Ty<'tcx>), TyAndLayout(TyAndLayout<'tcx>) } (module-level `TyMaybeWithLayout`)

    // rustc: compiler/rustc_middle/src/ty/layout.rs:854 field_ty_or_layout
    function field_ty_or_layout(this_: TyAndLayout, cx: LayoutCxLike, i: number): TyMaybeWithLayout {
      const tcx = cx.tcx_();
      const tag_layout = (tag: Scalar): TyAndLayout => {
        const layout = tcx.mk_layout(LayoutData.scalar(cx, tag));
        return new abi_TyAndLayout(PrimitiveExt.to_ty(Scalar.primitive(tag), tcx), layout);
      };

      const k = this_.ty.kind();
      switch (k.$) {
        case "Bool":
        case "Char":
        case "Int":
        case "Uint":
        case "Float":
        case "FnPtr":
        case "Never":
        case "FnDef":
        case "CoroutineWitness":
        case "Foreign":
        case "Dynamic":
          return bug(`TyAndLayout::field(${dbg_TyAndLayout(this_)}): not applicable`);

        case "Pat": {
          const base = k._0;
          assert_eq(i, 0, dbg_int);
          return { $: "Ty", _0: base };
        }

        case "UnsafeBinder": {
          const bound_ty = k._0;
          const ty = tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(bound_ty), fold_Ty);
          return field_ty_or_layout(new abi_TyAndLayout(ty, this_.layout), cx, i);
        }

        // Potentially-wide pointers.
        case "Ref":
        case "RawPtr": {
          const pointee = k.$ === "Ref" ? k._1 : k._0;
          assert(i < FieldsShape.count(this_.fields), "assertion failed: i < this.fields.count()");

          // Reuse the wide `*T` type as its own thin pointer data field.
          // This provides information about, e.g., DST struct pointees
          // (which may have no non-DST form), and will work as long
          // as the `Abi` or `FieldsShape` is checked by users.
          if (i === 0) {
            const nil = tcx.types.unit;
            const unit_ptr_ty = this_.ty.is_raw_ptr() ? Ty.new_mut_ptr(tcx, nil) : Ty.new_mut_ref(tcx, tcx.lifetimes.re_static, nil);

            // NOTE: using an fully monomorphized typing env and `unwrap`-ing
            // the `Result` should always work because the type is always either
            // `*mut ()` or `&'static mut ()`.
            const typing_env = TypingEnv.fully_monomorphized();
            return {
              $: "TyAndLayout",
              _0: new abi_TyAndLayout(this_.ty, unwrap_result(tcx.layout_of(typing_env.as_query_input(unit_ptr_ty)), debug_LayoutError).layout),
            };
          }

          const mk_dyn_vtable = (_principal: unknown): Ty => {
            // PORT: `ty::vtable_min_entries` (ty/vtable.rs) is not ported yet.
            const min_count: number = unported(
              "rustc_middle::ty::vtable::vtable_min_entries (TyAndLayout::field of a `dyn Trait` pointer's metadata)",
            );
            return Ty.new_imm_ref(
              tcx,
              tcx.lifetimes.re_static,
              // FIXME: properly type (e.g. usize and fn pointers) the fields.
              Ty.new_array(tcx, tcx.types.usize, min_count),
            );
          };

          let metadata: Ty;
          const metadata_def_id = tcx.lang_items().metadata_type();
          // Projection eagerly bails out when the pointee references errors,
          // fall back to structurally deducing metadata.
          if (metadata_def_id !== undefined && !TypeVisitableExt.references_error(pointee, fold_Ty)) {
            const metadata_ = tcx.normalize_erasing_regions(
              cx.typing_env_(),
              Unnormalized.new(Ty.new_projection(tcx, IsRigid.No, metadata_def_id, [pointee])),
              fold_Ty,
            );

            // Map `Metadata = DynMetadata<dyn Trait>` back to a vtable, since it
            // offers better information than `std::ptr::metadata::VTable`,
            // and we rely on this layout information to trigger a panic in
            // `std::mem::uninitialized::<&dyn Trait>()`, for example.
            const mk = metadata_.kind();
            let dk;
            if (
              mk.$ === "Adt" &&
              tcx.is_lang_item(mk._0.did(), LangItem.DynMetadata) &&
              (dk = mk._1.type_at(0).kind()).$ === "Dynamic"
            ) {
              metadata = mk_dyn_vtable(dk._0.principal());
            } else {
              metadata = metadata_;
            }
          } else {
            const tk = tcx.struct_tail_for_codegen(pointee, cx.typing_env_()).kind();
            switch (tk.$) {
              case "Slice":
              case "Str":
                metadata = tcx.types.usize;
                break;
              case "Dynamic":
                metadata = mk_dyn_vtable(tk._0.principal());
                break;
              default:
                return bug(`TyAndLayout::field(${dbg_TyAndLayout(this_)}): not applicable`);
            }
          }

          return { $: "Ty", _0: metadata };
        }

        // Arrays and slices.
        case "Array":
        case "Slice":
          return { $: "Ty", _0: k._0 };
        case "Str":
          return { $: "Ty", _0: tcx.types.u8 };

        // Tuples, coroutines and closures.
        case "Closure": {
          const args = k._1;
          return field_ty_or_layout(new abi_TyAndLayout(ClosureArgs.tupled_upvars_ty(args.as_closure()), this_.layout), cx, i);
        }

        case "CoroutineClosure": {
          const args = k._1;
          return field_ty_or_layout(
            new abi_TyAndLayout(CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()), this_.layout),
            cx,
            i,
          );
        }

        case "Coroutine": {
          const [def_id, args] = [k._0, k._1];
          const v = this_.variants;
          switch (v.$) {
            case "Empty":
              return unreachable();
            case "Single": {
              const index = v.index;
              return { $: "Ty", _0: iter_nth(iter_nth(sty().CoroutineArgsExt.state_tys(args.as_coroutine(), def_id, tcx), index), i) };
            }
            case "Multiple": {
              const { tag, tag_field } = v;
              if (FieldIdx.from_usize(i) === tag_field) {
                return { $: "TyAndLayout", _0: tag_layout(tag) };
              } else {
                return { $: "Ty", _0: index_slice(CoroutineArgs.upvar_tys(args.as_coroutine()), i) };
              }
            }
          }
          break;
        }

        case "Tuple": {
          const tys = k._0;
          return { $: "Ty", _0: index_slice(tys, i) };
        }

        // ADTs.
        case "Adt": {
          const [def, args] = [k._0, k._1];
          const v = this_.variants;
          switch (v.$) {
            case "Single": {
              const index = v.index;
              const field = index_slice(def.variant(index).fields, FieldIdx.from_usize(i));
              return { $: "Ty", _0: Unnormalized.skip_norm_wip(field.ty(tcx, args)) };
            }
            case "Empty":
              return panic("there is no field in Variants::Empty types");

            // Discriminant field for enums (where applicable).
            case "Multiple": {
              const tag = v.tag;
              assert_eq(i, 0, dbg_int);
              return { $: "TyAndLayout", _0: tag_layout(tag) };
            }
          }
          break;
        }

        case "Alias":
        case "Bound":
        case "Placeholder":
        case "Param":
        case "Infer":
        case "Error":
          return bug(`TyAndLayout::field: unexpected type \`${pretty().display_Ty(this_.ty)}\``);
      }
      return unreachable();
    }

    const r = field_ty_or_layout(this_, cx, i);
    switch (r.$) {
      case "Ty": {
        const field_ty = r._0;
        const l = cx.tcx_().layout_of(cx.typing_env_().as_query_input(field_ty));
        if (l.$ === "Err") {
          const e = l._0;
          return bug(
            `failed to get layout for \`${pretty().display_Ty(field_ty)}\`: ${format_debug(e, debug_LayoutError, PLAIN)},\ndespite it being a field (#${i}) of an existing layout: ${format_debug(this_, debug_TyAndLayout_Ty, PRETTY)}`,
          );
        }
        return l._0;
      }
      case "TyAndLayout":
        return r._0;
    }
  },

  /// Compute the information for the pointer stored at the given offset inside this type.
  /// This will recurse into fields of ADTs to find the inner pointer.
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1050 ty_and_layout_pointee_info_at
  ty_and_layout_pointee_info_at(this_: TyAndLayout, cx: LayoutCxLike, offset: Size): PointeeInfo | undefined {
    const tcx = cx.tcx_();
    const typing_env = cx.typing_env_();

    // Use conservative pointer kind if not optimizing. This saves us the
    // Freeze/Unpin queries, and can save time in the codegen backend (noalias
    // attributes in LLVM have compile-time cost even in unoptimized builds).
    const optimize = tcx.sess.opts.optimize !== "No";

    let pointee_info: PointeeInfo | undefined;
    const k = this_.ty.kind();
    let pointee: Ty | undefined;
    if ((k.$ === "RawPtr" || k.$ === "FnPtr") && offset.bytes() === 0) {
      pointee_info = { safe: undefined, size: Size.ZERO, align: Align.ONE };
    } else if (k.$ === "Ref" && offset.bytes() === 0) {
      const [ty, mt] = [k._1, k._2];
      const layout_r = tcx.layout_of(typing_env.as_query_input(ty));
      if (layout_r.$ === "Ok") {
        const layout = layout_r._0;
        let kind: PointerKind;
        let size: Size;

        switch (mt) {
          case "Not": {
            const frozen = optimize && ty.is_freeze(tcx, typing_env);
            kind = { $: "SharedRef", frozen };

            // Set the `size` to zero for non-frozen shared references.
            //
            // `PointeeInfo::size` is defined to allow adding spurious reads.
            // Adding spurious reads is only valid for `&Freeze` and `&mut Unpin`
            // references, as otherwise the spurious read can invalidate aliasing
            // references.
            //
            // See discussions in
            // - https://github.com/rust-lang/unsafe-code-guidelines/issues/381
            // - https://github.com/llvm/llvm-project/pull/218413
            // - https://discourse.llvm.org/t/interaction-of-noalias-and-dereferenceable/66979
            size = layout.size.mul(frozen ? 1 : 0);
            break;
          }
          case "Mut": {
            const unpin = optimize && ty.is_unpin(tcx, typing_env) && ty.is_unsafe_unpin(tcx, typing_env);
            kind = { $: "MutableRef", unpin };

            // Set the `size` to zero for non-unpin unique references.
            // See the above comment for reasons to do this.
            size = layout.size.mul(unpin ? 1 : 0);
            break;
          }
        }

        pointee_info = { safe: kind, size, align: layout.align.abi };
      } else {
        pointee_info = undefined;
      }
    } else if (k.$ === "Adt" && offset.bytes() === 0 && (pointee = this_.ty.boxed_ty()) !== undefined) {
      const pointee_ = pointee;
      const layout_r = tcx.layout_of(typing_env.as_query_input(pointee_));
      if (layout_r.$ === "Ok") {
        const layout = layout_r._0;
        // Same logic as for mutable references above.
        const unpin = optimize && pointee_.is_unpin(tcx, typing_env) && pointee_.is_unsafe_unpin(tcx, typing_env);
        const size = layout.size.mul(unpin ? 1 : 0);

        pointee_info = {
          safe: { $: "Box", unpin, global: this_.ty.is_box_global(tcx) },
          size,
          align: layout.align.abi,
        };
      } else {
        pointee_info = undefined;
      }
    } else {
      let data_variant: TyAndLayout | undefined;
      const v = this_.variants;
      // Within the discriminant field, only the niche itself is
      // always initialized, so we only check for a pointer at its
      // offset.
      //
      // Our goal here is to check whether this represents a
      // "dereferenceable or null" pointer, so we need to ensure
      // that there is only one other variant, and it must be null.
      // Below, we will then check whether the pointer is indeed
      // dereferenceable.
      if (
        v.$ === "Multiple" &&
        v.tag_encoding.$ === "Niche" &&
        v.variants.length === 2 &&
        // PORT: `Size`'s derived `PartialEq` compares the byte count.
        FieldsShape.offset(this_.fields, v.tag_field).bytes() === offset.bytes()
      ) {
        const { untagged_variant, niche_variants, niche_start } = v.tag_encoding;
        const tagged_variant = untagged_variant === VariantIdx.ZERO ? VariantIdx.from_u32(1) : VariantIdx.from_u32(0);
        assert_eq(tagged_variant, niche_variants.start, dbg_int);
        if (niche_start === 0n) {
          // The other variant is encoded as "null", so we can recurse searching for
          // a pointer here. This relies on the fact that the codegen backend
          // only adds "dereferenceable" if there's also a "nonnull" proof,
          // and that null is aligned for all alignments so it's okay to forward
          // the pointer's alignment.
          data_variant = this_.for_variant(cx, untagged_variant);
        } else {
          data_variant = undefined;
        }
      } else if (v.$ === "Multiple") {
        data_variant = undefined;
      } else {
        data_variant = this_;
      }

      if (
        data_variant !== undefined &&
        // We're not interested in any unions.
        data_variant.fields.$ === "Union"
      ) {
        data_variant = undefined;
      }

      let result: PointeeInfo | undefined = undefined;

      if (data_variant !== undefined) {
        const variant = data_variant;
        // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
        // (requires passing in the expected address space from the caller)
        const ptr_end = offset.add(PrimitiveC.size({ $: "Pointer", _0: AddressSpace.ZERO }, cx));
        for (let i = 0; i < FieldsShape.count(variant.fields); i++) {
          const field_start = FieldsShape.offset(variant.fields, i);
          // PORT: `Size`'s derived `PartialOrd` compares the byte count.
          if (field_start.bytes() <= offset.bytes()) {
            const field = variant.field(cx, i);
            const field_r = MaybeResult_T.to_result(field);
            if (field_r.$ === "Ok") {
              const field = field_r._0;
              if (ptr_end.bytes() <= field_start.add(field.size).bytes()) {
                // We found the right field, look inside it.
                const field_info = field.pointee_info_at(cx, offset.sub(field_start));
                result = field_info;
              } else {
                result = undefined;
              }
            } else {
              result = undefined;
            }
            if (result !== undefined) {
              break;
            }
          }
        }
      }

      // Patch result if we are a MaybeDangling-like type.
      if (this_.ty.is_like_maybe_dangling() && result !== undefined) {
        const info = result;
        result = {
          // Mark the pointer as raw
          // (thus removing noalias/readonly/etc in case of the llvm backend)
          safe: undefined,
          // Make sure we don't assert dereferenceability of the pointer.
          size: Size.ZERO,
          // Preserve the alignment assertion! That is required even inside `MaybeDangling`.
          align: info.align,
        };
      }

      pointee_info = result;
    }

    // debug!(
    //     "pointee_info_at (offset={:?}, type kind: {:?}) => {:?}",
    //     offset,
    //     this.ty.kind(),
    //     pointee_info
    // );

    return pointee_info;
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1229 is_adt
  is_adt(this_: TyAndLayout): boolean {
    return this_.ty.kind().$ === "Adt";
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1233 is_enum
  is_enum(this_: TyAndLayout): boolean {
    const k = this_.ty.kind();
    return k.$ === "Adt" && k._0.is_enum();
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1237 is_never
  is_never(this_: TyAndLayout): boolean {
    return this_.ty.kind().$ === "Never";
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1241 is_tuple
  is_tuple(this_: TyAndLayout): boolean {
    return this_.ty.kind().$ === "Tuple";
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1245 is_unit
  is_unit(this_: TyAndLayout): boolean {
    const k = this_.ty.kind();
    return k.$ === "Tuple" && k._0.length === 0;
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1249 is_transparent
  is_transparent(this_: TyAndLayout): boolean {
    const k = this_.ty.kind();
    return k.$ === "Adt" && k._0.repr().transparent();
  },

  /// Is this type `core::num::Complex<T>`?
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1254 is_complex_number_lang_item
  is_complex_number_lang_item(this_: TyAndLayout, cx: LayoutCxLike): boolean {
    const def = this_.ty.ty_adt_def();
    if (def === undefined) return false;
    return cx.tcx_().is_lang_item(def.did(), LangItem.Complex);
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:1259 is_scalable_vector
  is_scalable_vector(this_: TyAndLayout): boolean {
    return this_.ty.is_scalable_vector();
  },

  /// See [`TyAndLayout::pass_indirectly_in_non_rustic_abis`] for details.
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1264 is_pass_indirectly_in_non_rustic_abis_flag_set
  is_pass_indirectly_in_non_rustic_abis_flag_set(this_: TyAndLayout): boolean {
    const k = this_.ty.kind();
    return k.$ === "Adt" && ReprFlags.contains(k._0.repr().flags, ReprFlags.PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS);
  },
};
register_ty_abi_interface(TyAbiInterface_Ty);

/** `Iterator::nth(n).unwrap()` (PORT: the lazy iterators of `state_tys`). */
function iter_nth<T>(it: Iterable<T>, n: number): T {
  let k = 0;
  for (const x of it) {
    if (k === n) return x;
    k++;
  }
  return panic("called `Option::unwrap()` on a `None` value");
}

/** `slice[i]` (panics like Rust's bounds check). */
function index_slice<T>(xs: readonly T[], i: number): T {
  if (i >= xs.length) panic(`index out of bounds: the len is ${xs.length} but the index is ${i}`);
  return xs[i]!;
}

/// Calculates whether a function's ABI can unwind or not.
///
/// This takes two primary parameters:
///
/// * `fn_def_id` - the `DefId` of the function. If this is provided then we can
///   determine more precisely if the function can unwind. If this is not provided
///   then we will only infer whether the function can unwind or not based on the
///   ABI of the function. For example, a function marked with `#[rustc_nounwind]`
///   is known to not unwind even if it's using Rust ABI.
///
/// * `abi` - this is the ABI that the function is defined with. This is the
///   primary factor for determining whether a function can unwind or not.
///
/// Note that in this case unwinding is not necessarily panicking in Rust. Rust
/// panics are implemented with unwinds on most platform (when
/// `-Cpanic=unwind`), but this also accounts for `-Cpanic=abort` build modes.
/// Notably unwinding is disallowed for more non-Rust ABIs unless it's
/// specifically in the name (e.g. `"C-unwind"`). Unwinding within each ABI is
/// defined for each ABI individually, but it always corresponds to some form of
/// stack-based unwinding (the exact mechanism of which varies
/// platform-by-platform).
///
/// Rust functions are classified whether or not they can unwind based on the
/// active "panic strategy". In other words Rust functions are considered to
/// unwind in `-Cpanic=unwind` mode and cannot unwind in `-Cpanic=abort` mode.
/// Note that Rust supports intermingling panic=abort and panic=unwind code, but
/// only if the final panic mode is panic=abort. In this scenario any code
/// previously compiled assuming that a function can unwind is still correct, it
/// just never happens to actually unwind at runtime.
///
/// This function's answer to whether or not a function can unwind is quite
/// impactful throughout the compiler. This affects things like:
///
/// * Calling a function which can't unwind means codegen simply ignores any
///   associated unwinding cleanup.
/// * Calling a function which can unwind from a function which can't unwind
///   causes the `abort_unwinding_calls` MIR pass to insert a landing pad that
///   aborts the process.
/// * This affects whether functions have the LLVM `nounwind` attribute, which
///   affects various optimizations and codegen.
// #[inline]
// #[tracing::instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_middle/src/ty/layout.rs:1311 fn_can_unwind
export function fn_can_unwind(tcx: TyCtxt, fn_def_id: DefId | undefined, abi: ExternAbi): boolean {
  if (fn_def_id !== undefined) {
    const did = fn_def_id;
    // Special attribute for functions which can't unwind.
    if (CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(did) as CodegenFnAttrs).flags, CodegenFnAttrFlags.NEVER_UNWIND)) {
      return false;
    }

    // With `-C panic=abort`, all non-FFI functions are required to not unwind.
    //
    // Note that this is true regardless ABI specified on the function -- a `extern "C-unwind"`
    // function defined in Rust is also required to abort.
    if (!target_spec().PanicStrategy.unwinds(tcx.sess.panic_strategy()) && !tcx.is_foreign_item(did)) {
      return false;
    }

    // With -Z panic-in-drop=abort, `drop_glue` never unwinds.
    //
    // This is not part of `codegen_fn_attrs` as it can differ between crates
    // and therefore cannot be computed in core.
    if (!target_spec().PanicStrategy.unwinds(tcx.sess.opts.unstable_opts.panic_in_drop) && tcx.is_lang_item(did, LangItem.DropGlue)) {
      return false;
    }
  }

  // Otherwise if this isn't special then unwinding is generally determined by
  // the ABI of the itself. ABIs like `C` have variants which also
  // specifically allow unwinding (`C-unwind`), but not all platform-specific
  // ABIs have such an option. Otherwise the only other thing here is Rust
  // itself, and those ABIs are determined by the panic strategy configured
  // for this compilation.
  // use ExternAbi::*;
  switch (abi.$) {
    case "C":
    case "System":
    case "Cdecl":
    case "Stdcall":
    case "Fastcall":
    case "Vectorcall":
    case "Thiscall":
    case "Aapcs":
    case "Win64":
    case "SysV64":
      return abi.unwind;
    case "PtxKernel":
    case "Msp430Interrupt":
    case "X86Interrupt":
    case "GpuKernel":
    case "EfiApi":
    case "AvrInterrupt":
    case "AvrNonBlockingInterrupt":
    case "CmseNonSecureCall":
    case "CmseNonSecureEntry":
    case "Custom":
    case "RiscvInterruptM":
    case "RiscvInterruptS":
    case "RustInvalid":
    case "Swift":
    case "LlvmIntrinsic":
      return false;
    case "Rust":
    case "RustCall":
    case "RustCold":
    case "RustPreserveNone":
    case "RustTail":
      return target_spec().PanicStrategy.unwinds(tcx.sess.panic_strategy());
  }
}

/// Error produced by attempting to compute or adjust a `FnAbi`.
// #[derive(Copy, Clone, Debug, StableHash)]
export type FnAbiError =
  /// Error produced by a `layout_of` call, while computing `FnAbi` initially.
  { readonly $: "Layout"; readonly _0: LayoutError };
// derive(Debug)
export const debug_FnAbiError: Debug<FnAbiError> = (v, f) => debug_tuple(f, "Layout", [debug_LayoutError(v._0, f)]);

// impl<'a, 'b> Diagnostic<'a> for FnAbiError<'b>
// rustc: compiler/rustc_middle/src/ty/layout.rs:1384 into_diag
export function FnAbiError_into_diag(self: FnAbiError, dcx: DiagCtxtHandle, level: Level): Diag {
  switch (self.$) {
    case "Layout": {
      const e = self._0;
      return Diag.new(dcx, level, display_LayoutError(e));
    }
  }
}

// FIXME(eddyb) maybe use something like this for an unified `fn_abi_of`, not
// just for error handling.
// #[derive(Debug)]
export type FnAbiRequest =
  | { readonly $: "OfFnPtr"; readonly sig: PolyFnSig; readonly extra_args: List<Ty> }
  | { readonly $: "OfInstance"; readonly instance: Instance; readonly extra_args: List<Ty> };
// derive(Debug)
// PORT (layout-contract): `ty::Instance` / `PolyFnSig` Debug are not reachable yet (`Instance` is pending, M4).
export const debug_FnAbiRequest: Debug<FnAbiRequest> = (v: FnAbiRequest, _f: Fmt) =>
  unported(`rustc_middle::ty::layout::FnAbiRequest Debug (${v.$}: ty::Instance / PolyFnSig Debug, M4)`);

/// Trait for contexts that want to be able to compute `FnAbi`s.
/// This automatically gives access to `FnAbiOf`, through a blanket `impl`.
// pub trait FnAbiOfHelpers<'tcx>: LayoutOfHelpers<'tcx>
// PORT (layout-contract): `FR` is `Self::FnAbiOfResult`, `FE` its `MaybeResult::Error` (header).
export interface FnAbiOfHelpers<R, E, FR, FE> extends LayoutOfHelpers<R, E> {
  /// The `&FnAbi`-wrapping type (or `&FnAbi` itself), which will be
  /// returned from `fn_abi_of_*` (see also `handle_fn_abi_err`).
  // type FnAbiOfResult: MaybeResult<&'tcx FnAbi<'tcx, Ty<'tcx>>> = &'tcx FnAbi<'tcx, Ty<'tcx>>;
  readonly FnAbiOfResult: MaybeResult<FnAbi<Ty>, FR, FE>;

  /// Helper used for `fn_abi_of_*`, to adapt `tcx.fn_abi_of_*(...)` into a
  /// `Self::FnAbiOfResult` (which does not need to be a `Result<...>`).
  ///
  /// Most `impl`s, which propagate `FnAbiError`s, should simply return `err`,
  /// but this hook allows e.g. codegen to return only `&FnAbi` from its
  /// `cx.fn_abi_of_*(...)`, without any `Result<...>` around it to deal with
  /// (and any `FnAbiError`s are turned into fatal errors or ICEs).
  ///
  /// Codegen backends should use [`codegen_handle_fn_abi_err`] as implementation.
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1415 handle_fn_abi_err
  handle_fn_abi_err(err: FnAbiError, span: Span, fn_abi_request: FnAbiRequest): FE;
}

/// Implementation of [`FnAbiOfHelpers::handle_fn_abi_err`] for codegen backends.
// rustc: compiler/rustc_middle/src/ty/layout.rs:1424 codegen_handle_fn_abi_err
export function codegen_handle_fn_abi_err(tcx: TyCtxt, err: FnAbiError, span: Span, fn_abi_request: FnAbiRequest): ErrorGuaranteed {
  if (err.$ === "Layout" && (err._0.$ === "SizeOverflow" || err._0.$ === "InvalidSimd")) {
    // PORT: `Spanned { span, node: err }` as a `Diagnostic` (rustc_errors `impl Diagnostic for Spanned<T>`).
    const node = { into_diag: (dcx: DiagCtxtHandle, level: Level) => FnAbiError_into_diag(err, dcx, level) };
    return tcx.dcx().emit_err({ into_diag: (dcx, level) => Spanned_into_diag({ span, node }, dcx, level) });
  }
  switch (fn_abi_request.$) {
    case "OfFnPtr":
      // span_bug!(span, "`fn_abi_of_fn_ptr({sig}, {extra_args:?})` failed: {err:?}",);
      // PORT: the message needs `PolyFnSig` Display (not ported); stops before formatting.
      return unported("rustc_middle::ty::layout::codegen_handle_fn_abi_err (span_bug message: PolyFnSig Display, M4)");
    case "OfInstance":
      // span_bug!(span, "`fn_abi_of_instance({instance}, {extra_args:?})` failed: {err:?}",);
      // PORT: the message needs `ty::Instance` Display (`Instance` is pending, M4); stops before formatting.
      return unported("rustc_middle::ty::layout::codegen_handle_fn_abi_err (span_bug message: ty::Instance Display, M4)");
  }
}

/// Blanket extension trait for contexts that can compute `FnAbi`s.
// pub trait FnAbiOf<'tcx>: FnAbiOfHelpers<'tcx>
export interface FnAbiOf<R, E, FR, FE> extends FnAbiOfHelpers<R, E, FR, FE> {
  // (provided) ty/layout.rs:1452 fn_abi_of_fn_ptr -> FnAbiOf_provided.fn_abi_of_fn_ptr
  fn_abi_of_fn_ptr(sig: PolyFnSig, extra_args: List<Ty>): FR;
  // (provided) ty/layout.rs:1481 fn_abi_of_instance_no_deduced_attrs -> FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs
  fn_abi_of_instance_no_deduced_attrs(instance: Instance, extra_args: List<Ty>): FR;
  // (provided) ty/layout.rs:1520 fn_abi_of_instance -> FnAbiOf_provided.fn_abi_of_instance
  fn_abi_of_instance(instance: Instance, extra_args: List<Ty>): FR;
}

/** PORT: the provided methods of `FnAbiOf` (the blanket `impl<C: FnAbiOfHelpers> FnAbiOf for C`, header). */
export const FnAbiOf_provided = {
  /// Compute a `FnAbi` suitable for indirect calls, i.e. to `fn` pointers.
  ///
  /// NB: this doesn't handle virtual calls - those should use `fn_abi_of_instance`
  /// instead, where the instance is an `InstanceKind::Virtual`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1452 fn_abi_of_fn_ptr
  fn_abi_of_fn_ptr<R, E, FR, FE>(self: FnAbiOfHelpers<R, E, FR, FE>, sig: PolyFnSig, extra_args: List<Ty>): FR {
    // FIXME(eddyb) get a better `span` here.
    const span = self.layout_tcx_at_span();
    const tcx = self.tcx_().at(span);

    // PORT: the query value is `Result<unknown, FnAbiError>` in queries.gen.ts (`FnAbi` is pending, M4).
    const r = tcx.fn_abi_of_fn_ptr(self.typing_env_().as_query_input([sig, extra_args])) as Result<FnAbi<Ty>, FnAbiError>;
    return self.FnAbiOfResult.from(
      r.$ === "Err" ? Err(self.handle_fn_abi_err(/* * */ r._0, span, { $: "OfFnPtr", sig, extra_args })) : r,
    );
  },

  /// Compute a `FnAbi` suitable for declaring/defining an `fn` instance, and for direct calls*
  /// to an `fn`. Indirectly-passed parameters in the returned ABI might not include all possible
  /// codegen optimization attributes (such as `ReadOnly` or `CapturesNone`), as deducing these
  /// requires inspection of function bodies that can lead to cycles when performed during typeck.
  /// Post typeck, you should prefer the optimized ABI returned by `fn_abi_of_instance`.
  ///
  /// NB: the ABI returned by this query must not differ from that returned by
  ///     `fn_abi_of_instance` in any other way.
  ///
  /// * that includes virtual calls, which are represented by "direct calls" to an
  ///   `InstanceKind::Virtual` instance (of `<dyn Trait as Trait>::fn`).
  // #[inline]
  // #[tracing::instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1481 fn_abi_of_instance_no_deduced_attrs
  fn_abi_of_instance_no_deduced_attrs<R, E, FR, FE>(self: FnAbiOfHelpers<R, E, FR, FE>, instance: Instance, extra_args: List<Ty>): FR {
    // FIXME(eddyb) get a better `span` here.
    const span = self.layout_tcx_at_span();
    const tcx = self.tcx_().at(span);

    // PORT: the query value is `Result<unknown, FnAbiError>` in queries.gen.ts (`FnAbi` is pending, M4).
    const r = tcx.fn_abi_of_instance_no_deduced_attrs(self.typing_env_().as_query_input([instance, extra_args])) as Result<
      FnAbi<Ty>,
      FnAbiError
    >;
    if (r.$ === "Err") {
      const err = r._0;
      // HACK(eddyb) at least for definitions of/calls to `Instance`s,
      // we can get some kind of span even if one wasn't provided.
      // However, we don't do this early in order to avoid calling
      // `def_span` unconditionally (which may have a perf penalty).
      const span_ = !Span.is_dummy(span) ? span : tcx.def_span(Instance_def_id(instance));
      return self.FnAbiOfResult.from(Err(self.handle_fn_abi_err(err, span_, { $: "OfInstance", instance, extra_args })));
    }
    return self.FnAbiOfResult.from(r);
  },

  /// Compute a `FnAbi` suitable for declaring/defining an `fn` instance, and for direct calls*
  /// to an `fn`. Indirectly-passed parameters in the returned ABI will include applicable
  /// codegen optimization attributes, including `ReadOnly` and `CapturesNone` -- deduction of
  /// which requires inspection of function bodies that can lead to cycles when performed during
  /// typeck. During typeck, you should therefore use instead the unoptimized ABI returned by
  /// `fn_abi_of_instance_no_deduced_attrs`.
  ///
  /// * that includes virtual calls, which are represented by "direct calls" to an
  ///   `InstanceKind::Virtual` instance (of `<dyn Trait as Trait>::fn`).
  // #[inline]
  // #[tracing::instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:1520 fn_abi_of_instance
  fn_abi_of_instance<R, E, FR, FE>(self: FnAbiOfHelpers<R, E, FR, FE>, instance: Instance, extra_args: List<Ty>): FR {
    // FIXME(eddyb) get a better `span` here.
    const span = self.layout_tcx_at_span();
    const tcx = self.tcx_().at(span);

    // PORT: `tcx.fn_abi_of_instance(..)` on a `TyCtxtAt` is the inherent `TyCtxt::fn_abi_of_instance` (ty/mod.rs:2333,
    // through `Deref`): there is no such query.
    const r = tcx.deref().fn_abi_of_instance(self.typing_env_().as_query_input([instance, extra_args]));
    if (r.$ === "Err") {
      const err = r._0;
      // HACK(eddyb) at least for definitions of/calls to `Instance`s,
      // we can get some kind of span even if one wasn't provided.
      // However, we don't do this early in order to avoid calling
      // `def_span` unconditionally (which may have a perf penalty).
      const span_ = !Span.is_dummy(span) ? span : tcx.def_span(Instance_def_id(instance));
      return self.FnAbiOfResult.from(Err(self.handle_fn_abi_err(err, span_, { $: "OfInstance", instance, extra_args })));
    }
    return self.FnAbiOfResult.from(r);
  },
};

/** `ty::Instance::def_id` (PORT: `Instance` is pending (ty/decls.ts, M4)). */
function Instance_def_id(_instance: Instance): DefId {
  return unported("rustc_middle::ty::instance::Instance::def_id (Instance is pending, M4)");
}
