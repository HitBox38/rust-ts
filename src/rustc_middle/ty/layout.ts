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
  type Align,
  type Float,
  type HasDataLayout,
  type Integer,
  LayoutCalculator,
  type PointeeInfo,
  type Primitive,
  register_ty_abi_interface,
  type ReprOptions,
  type Size,
  type TargetDataLayout,
  type TyAbiInterface,
  type TyAndLayout as abi_TyAndLayout,
  type VariantIdx,
  debug_Align,
  debug_Size,
  debug_TyAndLayout,
} from "../../rustc_abi/lib.ts";
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import { String_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import type { Diag, DiagCtxtHandle, Level } from "../../rustc_errors/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span, debug_ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { debug_Limit, display_Limit } from "../../rustc_structures/limit.ts";
import type { Limit } from "../../rustc_structures/limit.ts";
import type { Target, X86Abi } from "../../rustc_target/spec/mod.ts";
import { type Debug, debug_bool, debug_option, debug_struct, debug_tuple, type Fmt } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported, unreachable } from "../../std/panic.ts";
import { Err, type Result } from "../../std/result.ts";
import { TyCtxtAt } from "../query/calls.ts";
import { TyCtxt } from "./context.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import type { FnAbi, Instance, List } from "./decls.ts";
import type { Ty, TypingEnv } from "./mod.ts";
import { debug_NormalizationError, NormalizationError } from "./normalize_erasing_regions.ts";
import { debug_Ty } from "./structural_impls.ts";

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
  return require("./print/pretty.ts") as typeof import("./print/pretty.ts");
}

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
  // stub: compiler/rustc_middle/src/ty/layout.rs:79 discr_range_of_repr (lane middle-layout)
  discr_range_of_repr(_tcx: TyCtxt, _ty: Ty, _repr: ReprOptions, _min_negative: bigint, _max_positive: bigint): [Integer, boolean] {
    return unported("rustc_middle::ty::layout::IntegerExt::discr_range_of_repr");
  },
};

// #[extension(pub trait FloatExt)] impl abi::Float
export const FloatExt = {
  // #[inline]
  // stub: compiler/rustc_middle/src/ty/layout.rs:137 to_ty (lane middle-layout)
  to_ty(_self: Float, _tcx: TyCtxt): Ty {
    return unported("rustc_middle::ty::layout::FloatExt::to_ty");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:157 from_float_ty (lane middle-layout)
  from_float_ty(_fty: FloatTy): Float {
    return unported("rustc_middle::ty::layout::FloatExt::from_float_ty");
  },
};

// #[extension(pub trait PrimitiveExt)] impl Primitive
export const PrimitiveExt = {
  // #[inline]
  // stub: compiler/rustc_middle/src/ty/layout.rs:171 to_ty (lane middle-layout)
  to_ty(_self: Primitive, _tcx: TyCtxt): Ty {
    return unported("rustc_middle::ty::layout::PrimitiveExt::to_ty");
  },

  /// Return an *integer* type matching this primitive.
  /// Useful in particular when dealing with enum discriminants.
  // #[inline]
  // stub: compiler/rustc_middle/src/ty/layout.rs:183 to_int_ty (lane middle-layout)
  to_int_ty(_self: Primitive, _tcx: TyCtxt): Ty {
    return unported("rustc_middle::ty::layout::PrimitiveExt::to_int_ty");
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

  // stub: compiler/rustc_middle/src/ty/layout.rs:222 from_intrinsic (lane middle-layout)
  from_intrinsic(_intrinsic: Symbol): ValidityRequirement | undefined {
    return unported("rustc_middle::ty::layout::ValidityRequirement::from_intrinsic");
  },
} as const;
// derive(Debug)
export const debug_ValidityRequirement: Debug<ValidityRequirement> = (v) => v;
// impl fmt::Display for ValidityRequirement
// stub: compiler/rustc_middle/src/ty/layout.rs:233 fmt (lane middle-layout)
export function display_ValidityRequirement(_self: ValidityRequirement): string {
  return unported("rustc_middle::ty::layout::ValidityRequirement::fmt (Display)");
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
  // stub: compiler/rustc_middle/src/ty/layout.rs:350 compute (lane middle-layout)
  compute(_ty: Ty, _tcx: TyCtxt, _typing_env: TypingEnv, _span: Span): Result<SizeSkeleton, LayoutError> {
    return unported("rustc_middle::ty::layout::SizeSkeleton::compute");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:359 compute_inner (lane middle-layout)
  compute_inner(_ty: Ty, _tcx: TyCtxt, _typing_env: TypingEnv, _span: Span, _depth: number): Result<SizeSkeleton, LayoutError> {
    return unported("rustc_middle::ty::layout::SizeSkeleton::compute_inner");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:601 same_size (lane middle-layout)
  same_size(_self: SizeSkeleton, _other: SizeSkeleton): boolean {
    return unported("rustc_middle::ty::layout::SizeSkeleton::same_size");
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
  // stub: compiler/rustc_middle/src/ty/layout.rs:804 ty_and_layout_for_variant (lane middle-layout)
  ty_and_layout_for_variant(_this: TyAndLayout, _cx: LayoutCxLike, _variant_index: VariantIdx): TyAndLayout {
    return unported("rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_for_variant");
  },

  // PORT (layout-contract): the nested `fn field_ty_or_layout` (:854) is the module-level `field_ty_or_layout` stub
  // below until the fill lane ports it inside this fn.
  // stub: compiler/rustc_middle/src/ty/layout.rs:848 ty_and_layout_field (lane middle-layout)
  ty_and_layout_field(_this: TyAndLayout, _cx: LayoutCxLike, _i: number): TyAndLayout {
    return unported("rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_field");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1050 ty_and_layout_pointee_info_at (lane middle-layout)
  ty_and_layout_pointee_info_at(_this: TyAndLayout, _cx: LayoutCxLike, _offset: Size): PointeeInfo | undefined {
    return unported("rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_pointee_info_at");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1229 is_adt (lane middle-layout)
  is_adt(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_adt");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1233 is_enum (lane middle-layout)
  is_enum(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_enum");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1237 is_never (lane middle-layout)
  is_never(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_never");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1241 is_tuple (lane middle-layout)
  is_tuple(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_tuple");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1245 is_unit (lane middle-layout)
  is_unit(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_unit");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1249 is_transparent (lane middle-layout)
  is_transparent(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_transparent");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1254 is_complex_number_lang_item (lane middle-layout)
  is_complex_number_lang_item(_this: TyAndLayout, _cx: LayoutCxLike): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_complex_number_lang_item");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1259 is_scalable_vector (lane middle-layout)
  is_scalable_vector(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_scalable_vector");
  },

  // stub: compiler/rustc_middle/src/ty/layout.rs:1264 is_pass_indirectly_in_non_rustic_abis_flag_set (lane middle-layout)
  is_pass_indirectly_in_non_rustic_abis_flag_set(_this: TyAndLayout): boolean {
    return unported("rustc_middle::ty::layout::TyAbiInterface::is_pass_indirectly_in_non_rustic_abis_flag_set");
  },
};
register_ty_abi_interface(TyAbiInterface_Ty);

// (nested in `ty_and_layout_field`, see there)
// stub: compiler/rustc_middle/src/ty/layout.rs:854 field_ty_or_layout (lane middle-layout)
export function field_ty_or_layout(_this: TyAndLayout, _cx: LayoutCxLike, _i: number): TyMaybeWithLayout {
  return unported("rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_field::field_ty_or_layout");
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
// stub: compiler/rustc_middle/src/ty/layout.rs:1311 fn_can_unwind (lane middle-layout)
export function fn_can_unwind(_tcx: TyCtxt, _fn_def_id: DefId | undefined, _abi: ExternAbi): boolean {
  return unported("rustc_middle::ty::layout::fn_can_unwind");
}

/// Error produced by attempting to compute or adjust a `FnAbi`.
// #[derive(Copy, Clone, Debug, StableHash)]
export type FnAbiError =
  /// Error produced by a `layout_of` call, while computing `FnAbi` initially.
  { readonly $: "Layout"; readonly _0: LayoutError };
// derive(Debug)
export const debug_FnAbiError: Debug<FnAbiError> = (v, f) => debug_tuple(f, "Layout", [debug_LayoutError(v._0, f)]);

// impl<'a, 'b> Diagnostic<'a> for FnAbiError<'b>
// stub: compiler/rustc_middle/src/ty/layout.rs:1384 into_diag (lane middle-layout)
export function FnAbiError_into_diag(_self: FnAbiError, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_middle::ty::layout::FnAbiError::into_diag");
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
// stub: compiler/rustc_middle/src/ty/layout.rs:1424 codegen_handle_fn_abi_err (lane middle-layout)
export function codegen_handle_fn_abi_err(_tcx: TyCtxt, _err: FnAbiError, _span: Span, _fn_abi_request: FnAbiRequest): ErrorGuaranteed {
  return unported("rustc_middle::ty::layout::codegen_handle_fn_abi_err");
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
  // stub: compiler/rustc_middle/src/ty/layout.rs:1452 fn_abi_of_fn_ptr (lane middle-layout)
  fn_abi_of_fn_ptr<R, E, FR, FE>(_self: FnAbiOfHelpers<R, E, FR, FE>, _sig: PolyFnSig, _extra_args: List<Ty>): FR {
    return unported("rustc_middle::ty::layout::FnAbiOf::fn_abi_of_fn_ptr");
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
  // stub: compiler/rustc_middle/src/ty/layout.rs:1481 fn_abi_of_instance_no_deduced_attrs (lane middle-layout)
  fn_abi_of_instance_no_deduced_attrs<R, E, FR, FE>(_self: FnAbiOfHelpers<R, E, FR, FE>, _instance: Instance, _extra_args: List<Ty>): FR {
    return unported("rustc_middle::ty::layout::FnAbiOf::fn_abi_of_instance_no_deduced_attrs");
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
  // stub: compiler/rustc_middle/src/ty/layout.rs:1520 fn_abi_of_instance (lane middle-layout)
  fn_abi_of_instance<R, E, FR, FE>(_self: FnAbiOfHelpers<R, E, FR, FE>, _instance: Instance, _extra_args: List<Ty>): FR {
    return unported("rustc_middle::ty::layout::FnAbiOf::fn_abi_of_instance");
  },
};
