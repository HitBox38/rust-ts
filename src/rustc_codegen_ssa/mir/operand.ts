// compiler/rustc_codegen_ssa/src/mir/operand.rs: NOT PORTED YET (lane ssa-operand-place, plan-m7 wave 41).
//
// PORT (ssa-contract): the type surface the traits (traits/*.ts) need, placed in the file lane ssa-operand-place will
// port: `OperandValue` (an enum with data: a `$`-tagged union, methods on the companion const, PORTING §5/§8) and
// `OperandRef` with its fields, and typed stubs for the methods the traits' provided methods call. Stubs carry no
// marker; the fill lane replaces each with the port (and its marker) in upstream order.
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import { unported } from "../../std/panic.ts";
import type { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { PlaceRef, PlaceValue } from "./place.ts";

/// The representation of a Rust value. The enum variant is in fact
/// uniquely determined by the value's type, but is kept as a
/// safety check.
// #[derive(Copy, Clone, Debug)]
export type OperandValue<V> =
  /// A reference to the actual operand. The data is guaranteed
  /// to be valid for the operand's lifetime.
  /// The [`PlaceValue::llextra`], if any, is the extra data (vtable or length)
  /// which indicates that it refers to an unsized rvalue.
  ///
  /// An `OperandValue` *must* be this variant for any type for which
  /// [`rustc_abi::LayoutData::is_ssa_standalone`] returns `false`.
  /// (That basically amounts to "isn't one of the other variants".)
  ///
  /// This holds a [`PlaceValue`] (like a [`PlaceRef`] does) with a pointer
  /// to the location holding the value. The type behind that pointer is the
  /// one returned by [`LayoutTypeCodegenMethods::backend_type`].
  ///
  /// Note that a [`load_operand`] which produces this variant didn't actually
  /// *load* anything; it just put the pointer-to-place into this variant.
  ///
  /// [`load_operand`]: BuilderMethods::load_operand
  | { readonly $: "Ref"; _0: PlaceValue<V> }
  /// A single LLVM immediate value.
  ///
  /// An `OperandValue` *must* be this variant for any type that's
  /// [`BackendRepr::Scalar`], [`BackendRepr::SimdVector`], or
  /// [`BackendRepr::SimdScalableVector`].
  ///
  /// The backend value in this variant must be the *immediate* backend type,
  /// as returned by [`LayoutTypeCodegenMethods::immediate_backend_type`].
  ///
  /// Notably, that means that in LLVM a `bool` is `i1` here, even though we
  /// load and store `bool`s as LLVM's `i8` type. Methods such as
  /// [`BuilderMethods::load_operand`] and [`OperandRef::store_with_annotation`]
  /// will handle that correctly, but if you're using the value directly or
  /// implementing such methods, be sure to convert using
  /// [`BuilderMethods::from_immediate`] and [`BuilderMethods::to_immediate_scalar`]
  /// in the appropriate places.
  | { readonly $: "Immediate"; _0: V }
  /// A pair of immediate LLVM values.
  ///
  /// Notably this includes wide pointers, where the two values are the pointer
  /// and the metadata (slice length, vtable pointer, etc).
  ///
  /// # Invariants
  /// - For `Pair(a, b)`, `a` is always at offset 0, but may have `FieldIdx(1..)`
  /// - `b` is not at offset 0, because `V` is not a 1ZST type.
  /// - `a` and `b` will have a different FieldIdx, but otherwise `b`'s may be lower
  ///   or they may not be adjacent, due to arbitrary numbers of 1ZST fields that
  ///   will not affect the shape of the data which determines if `Pair` will be used.
  /// - An `OperandValue` *must* be this variant for any type that's [`BackendRepr::ScalarPair`].
  /// - The backend values in this variant must be the *immediate* backend types,
  /// as returned by [`LayoutTypeCodegenMethods::scalar_pair_element_backend_type`]
  /// with `immediate: true`. See the note in [`Self::Immediate`].
  | { readonly $: "Pair"; _0: V; _1: V }
  /// A value taking no bytes, and which therefore needs no LLVM value at all.
  ///
  /// If you ever need a `V` to pass to something, get a fresh poison value
  /// from [`ConstCodegenMethods::const_poison`].
  ///
  /// An `OperandValue` *must* be this variant for any type for which
  /// `is_zst` on its `Layout` returns `true`. Note however that
  /// these values can still require alignment.
  | { readonly $: "ZeroSized" };
export const OperandValue = {
  /** Shared frozen singleton of the unit variant. */
  ZeroSized: Object.freeze({ $: "ZeroSized" }) as { readonly $: "ZeroSized" },

  /** Stub (ssa-contract): `OperandValue::store` (mir/operand.rs:1005), called by `BuilderMethods`'s provided
   *  `typed_place_swap`. */
  store<B extends BackendTypes>(_self: OperandValue<B["Value"]>, _bx: BuilderMethods<B>, _dest: PlaceRef<B["Value"]>): void {
    return unported("ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/operand.rs store");
  },

  /** Stub (ssa-contract): `OperandValue::store_with_flags` (mir/operand.rs:1029), called by `BuilderMethods`'s
   *  provided `typed_place_copy_with_flags`. */
  store_with_flags<B extends BackendTypes>(
    _self: OperandValue<B["Value"]>,
    _bx: BuilderMethods<B>,
    _dest: PlaceRef<B["Value"]>,
    _flags: MemFlags,
  ): void {
    return unported("ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/operand.rs store_with_flags");
  },
} as const;

/// An `OperandRef` is an "SSA" reference to a Rust value, along with
/// its type.
///
/// NOTE: unless you know a value's type exactly, you should not
/// generate LLVM opcodes acting on it and instead act via methods,
/// to avoid nasty edge cases. In particular, using `Builder::store`
/// directly is sure to cause problems -- use `OperandRef::store`
/// instead.
// #[derive(Copy, Clone)]
export class OperandRef<V> {
  constructor(
    /// The value.
    public val: OperandValue<V>,

    /// The layout of value, based on its Rust type.
    public layout: TyAndLayout,

    /// Annotation for profiler visibility of move/copy operations.
    /// When set, the store operation should appear as an inlined call to this function.
    public move_annotation: Instance | undefined,
  ) {}
}
