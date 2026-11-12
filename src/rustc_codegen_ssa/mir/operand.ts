// Port of compiler/rustc_codegen_ssa/src/mir/operand.rs (lane ssa-operand-place, plan-m7 wave 41).
//
// PORT (ssa-operand-place): conventions as place.ts's header:
// - Copy semantics: `OperandValue`'s payloads and `OperandRef`'s fields are `readonly` (upstream `Copy`). Struct
//   updates (`OperandRef { layout, ..o }`) build a new object; nothing writes a shared one.
// - `OperandValue` is a `$`-tagged union; its methods live on the companion const (PORTING §8), declared by
//   `OperandValue_methods` and assigned in upstream order (its two `impl` blocks are far apart).
// - `{:?}` of a backend value needs `debug_V` (place.ts header): methods without a `bx`/`cx` take it as an optional
//   trailing argument.
// - The `impl FunctionCx` block (`maybe_codegen_consume_direct`, `codegen_consume`, `codegen_operand`,
//   `move_copy_annotation_instance`) is in `install_FunctionCx_operand`, which mod.ts calls after `class FunctionCx`.
// - `itertools::Either` is rustc_middle mir/mod.ts's `Either` (`Left`/`Right`, same derived Debug).
// - constant.rs `FunctionCx::eval_mir_constant_to_operand` / `immediate_const_vector` are the installed methods
//   (ssa-mir-rest; root at integ-w54, they were stubs).
import {
  type Align,
  debug_Align,
  debug_Scalar as abi_Scalar_debug,
  type FieldIdx,
  FieldsShape,
  FIRST_VARIANT,
  Scalar as abi_Scalar,
  Scalar_eq as abi_Scalar_eq,
  Size,
  Size_eq,
  debug_Size,
  type VariantIdx,
} from "../../rustc_abi/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.gen.ts";
import { alloc_range, type ConstAllocation } from "../../rustc_middle/mir/interpret/allocation.ts";
import { GlobalAlloc } from "../../rustc_middle/mir/interpret/mod.ts";
import { type CtfeProvenance, CtfeProvenance_from_AllocId, Pointer, Provenance_CtfeProvenance } from "../../rustc_middle/mir/interpret/pointer.ts";
import { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import type { ConstValue } from "../../rustc_middle/mir/consts.ts";
import { type Either } from "../../rustc_middle/mir/mod.ts";
import type { PlaceRef as mir_PlaceRef } from "../../rustc_middle/mir/statement.ts";
import { debug_PlaceRef as debug_mir_PlaceRef } from "../../rustc_middle/mir/statement.ts";
import { type Operand as mir_Operand, RuntimeChecks } from "../../rustc_middle/mir/syntax.ts";
import "../../rustc_middle/ty/consts.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { debug_TyAndLayout_Ty, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { debug_Ty, type Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type Debug, debug_struct, debug_tuple, format_debug, type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import { IntPredicate } from "../common.ts";
import { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";
import { debug_PlaceValue, debug_V_or_stop, PlaceRef, PlaceValue } from "./place.ts";
import { transmute_scalar } from "./rvalue.ts";

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
  | { readonly $: "Ref"; readonly _0: PlaceValue<V> }
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
  | { readonly $: "Immediate"; readonly _0: V }
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
  | { readonly $: "Pair"; readonly _0: V; readonly _1: V }
  /// A value taking no bytes, and which therefore needs no LLVM value at all.
  ///
  /// If you ever need a `V` to pass to something, get a fresh poison value
  /// from [`ConstCodegenMethods::const_poison`].
  ///
  /// An `OperandValue` *must* be this variant for any type for which
  /// `is_zst` on its `Layout` returns `true`. Note however that
  /// these values can still require alignment.
  | { readonly $: "ZeroSized" };

/** The companion of `OperandValue`: its unit singleton and its methods, in upstream order (header). */
export interface OperandValue_methods {
  /** Shared frozen singleton of the unit variant. */
  readonly ZeroSized: { readonly $: "ZeroSized" };
  // impl<V: CodegenObject> OperandValue<V>
  try_pointer_parts<V>(self: OperandValue<V>): [V, V | undefined] | undefined;
  pointer_parts<V>(self: OperandValue<V>, debug_V?: Debug<V>): [V, V | undefined];
  deref<V>(self: OperandValue<V>, align: Align, debug_V?: Debug<V>): PlaceValue<V>;
  is_expected_variant_for_type<V>(self: OperandValue<V>, ty: TyAndLayout): boolean;
  // impl<'a, 'tcx, V: CodegenObject> OperandValue<V>
  poison<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout): OperandValue<B["Value"]>;
  store<B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void;
  volatile_store<B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void;
  nontemporal_store<B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void;
  store_with_flags<B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>, flags: MemFlags): void;
}
export const OperandValue = {
  ZeroSized: Object.freeze({ $: "ZeroSized" }) as { readonly $: "ZeroSized" },
} as OperandValue_methods;

// derive(Debug)
export function debug_OperandValue<V>(v: OperandValue<V>, f: Fmt, debug_V: Debug<V>): string {
  switch (v.$) {
    case "Ref":
      return debug_tuple(f, "Ref", [debug_PlaceValue(v._0, f, debug_V)]);
    case "Immediate":
      return debug_tuple(f, "Immediate", [debug_V(v._0, f)]);
    case "Pair":
      return debug_tuple(f, "Pair", [debug_V(v._0, f), debug_V(v._1, f)]);
    case "ZeroSized":
      return "ZeroSized";
  }
}

/// Return the data pointer and optional metadata as backend values
/// if this value can be treat as a pointer.
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:95 try_pointer_parts
OperandValue.try_pointer_parts = function <V>(self: OperandValue<V>): [V, V | undefined] | undefined {
  switch (self.$) {
    case "Immediate": {
      const llptr = self._0;
      return [llptr, undefined];
    }
    case "Pair": {
      const llptr = self._0;
      const llextra = self._1;
      return [llptr, llextra];
    }
    case "Ref":
    case "ZeroSized":
      return undefined;
  }
};

/// Treat this value as a pointer and return the data pointer and
/// optional metadata as backend values.
///
/// If you're making a place, use [`Self::deref`] instead.
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:107 pointer_parts
OperandValue.pointer_parts = function <V>(self: OperandValue<V>, debug_V?: Debug<V>): [V, V | undefined] {
  return OperandValue.try_pointer_parts(self) ?? bug(`OperandValue cannot be a pointer: ${debug_OperandValue(self, PLAIN, debug_V_or_stop(debug_V))}`);
};

/// Treat this value as a pointer and return the place to which it points.
///
/// The pointer immediate doesn't inherently know its alignment,
/// so you need to pass it in. If you want to get it from a type's ABI
/// alignment, then maybe you want [`OperandRef::deref`] instead.
///
/// This is the inverse of [`PlaceValue::address`].
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:119 deref
OperandValue.deref = function <V>(self: OperandValue<V>, align: Align, debug_V?: Debug<V>): PlaceValue<V> {
  const [llval, llextra] = OperandValue.pointer_parts(self, debug_V);
  return new PlaceValue(llval, llextra, align);
};

// #[must_use]
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:125 is_expected_variant_for_type
OperandValue.is_expected_variant_for_type = function <V>(self: OperandValue<V>, ty: TyAndLayout): boolean {
  const repr = ty.backend_repr;
  if (self.$ === "ZeroSized" && repr.$ === "Memory") {
    return ty.is_zst();
  } else if (self.$ === "Ref" && repr.$ === "Memory") {
    return !ty.is_zst();
  } else if (self.$ === "Immediate" && (repr.$ === "Scalar" || repr.$ === "SimdVector" || repr.$ === "SimdScalableVector")) {
    return true;
  } else if (self.$ === "Pair" && repr.$ === "ScalarPair") {
    return true;
  } else {
    return false;
  }
};

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
    readonly val: OperandValue<V>,

    /// The layout of value, based on its Rust type.
    readonly layout: TyAndLayout,

    /// Annotation for profiler visibility of move/copy operations.
    /// When set, the store operation should appear as an inlined call to this function.
    readonly move_annotation: Instance | undefined,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:169 zero_sized
  static zero_sized<V>(layout: TyAndLayout): OperandRef<V> {
    assert(layout.is_zst(), "assertion failed: layout.is_zst()");
    return new OperandRef<V>(OperandValue.ZeroSized, layout, undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:174 from_const
  static from_const<B extends BackendTypes>(bx: BuilderMethods<B>, val: ConstValue, ty: Ty): OperandRef<B["Value"]> {
    const layout = bx.layout_of(ty);

    let val_: OperandValue<B["Value"]>;
    switch (val.$) {
      case "Scalar": {
        const x = val._0;
        const repr = layout.backend_repr;
        if (repr.$ !== "Scalar") {
          return bug(`from_const: invalid ByVal layout: ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)}`);
        }
        const scalar = repr._0;
        const llval = bx.scalar_to_backend(x, scalar, bx.immediate_backend_type(layout));
        val_ = { $: "Immediate", _0: llval };
        break;
      }
      case "ZeroSized":
        return OperandRef.zero_sized(layout);
      case "Slice": {
        const { alloc_id, meta } = val;
        const repr = layout.backend_repr;
        if (repr.$ !== "ScalarPair") {
          return bug(`from_const: invalid ScalarPair layout: ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)}`);
        }
        const a_scalar = repr.a;
        const a = Scalar.from_pointer(Pointer.new(CtfeProvenance_from_AllocId(alloc_id), Size.ZERO), bx.tcx_());
        const a_llval = bx.scalar_to_backend(a, a_scalar, bx.scalar_pair_element_backend_type(layout, 0, true));
        const b_llval = bx.const_usize(BigInt(meta));
        val_ = { $: "Pair", _0: a_llval, _1: b_llval };
        break;
      }
      case "Indirect": {
        const { alloc_id, offset } = val;
        const alloc = GlobalAlloc.unwrap_memory(bx.tcx_().global_alloc(alloc_id));
        return OperandRef.from_const_alloc(bx, layout, alloc, offset);
      }
    }

    return new OperandRef(val_, layout, undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:214 from_const_alloc
  private static from_const_alloc<B extends BackendTypes>(
    bx: BuilderMethods<B>,
    layout: TyAndLayout,
    alloc: ConstAllocation,
    offset: Size,
  ): OperandRef<B["Value"]> {
    const alloc_align = alloc.inner().align;
    assert(alloc_align.pow2 >= layout.align.abi.pow2, () => `${debug_Align(alloc_align, PLAIN)} < ${debug_Align(layout.align.abi, PLAIN)}`);

    const read_scalar = (start: Size, size: Size, s: abi_Scalar, ty: B["Type"]): B["Value"] => {
      const r = alloc.inner().read_scalar(
        bx,
        alloc_range(start, size),
        /*read_provenance*/ abi_Scalar.primitive(s).$ === "Pointer",
        Provenance_CtfeProvenance,
      );
      if (r.$ === "Ok") {
        return bx.scalar_to_backend(r._0, s, ty);
      } else {
        return bx.const_poison(ty);
      }
    };

    // It may seem like all types with `Scalar` or `ScalarPair` ABI are fair game at this point.
    // However, `MaybeUninit<u64>` is considered a `Scalar` as far as its layout is concerned --
    // and yet cannot be represented by an interpreter `Scalar`, since we have to handle the
    // case where some of the bytes are initialized and others are not. So, we need an extra
    // check that walks over the type of `mplace` to make sure it is truly correct to treat this
    // like a `Scalar` (or `ScalarPair`).
    const repr = layout.backend_repr;
    if (repr.$ === "Scalar" && repr._0.$ === "Initialized") {
      const s = repr._0;
      const size = abi_Scalar.size(s, bx);
      assert_eq(size, layout.size, (v) => debug_Size(v, PLAIN), Size_eq);
      const val = read_scalar(offset, size, s, bx.immediate_backend_type(layout));
      return new OperandRef<B["Value"]>({ $: "Immediate", _0: val }, layout, undefined);
    } else if (repr.$ === "ScalarPair" && repr.a.$ === "Initialized" && repr.b.$ === "Initialized") {
      const { a, b, b_offset: local_b_offset } = repr;
      const [a_size, b_size] = [abi_Scalar.size(a, bx), abi_Scalar.size(b, bx)];
      const alloc_b_offset = offset.add(local_b_offset);
      assert(alloc_b_offset.bytes() > 0, "assertion failed: alloc_b_offset.bytes() > 0");
      const a_val = read_scalar(offset, a_size, a, bx.scalar_pair_element_backend_type(layout, 0, true));
      const b_val = read_scalar(alloc_b_offset, b_size, b, bx.scalar_pair_element_backend_type(layout, 1, true));
      return new OperandRef<B["Value"]>({ $: "Pair", _0: a_val, _1: b_val }, layout, undefined);
    } else if (layout.is_zst()) {
      return OperandRef.zero_sized(layout);
    } else {
      // Neither a scalar nor scalar pair. Load from a place
      const base_addr = bx.static_addr_of(alloc, undefined);

      const llval = bx.const_ptr_byte_offset(base_addr, offset);
      return bx.load_operand(PlaceRef.new_sized(llval, layout));
    }
  }

  /// Asserts that this operand refers to a scalar and returns
  /// a reference to its value.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:282 immediate
  immediate(debug_V?: Debug<V>): V {
    const val = this.val;
    switch (val.$) {
      case "Immediate":
        return val._0;
      default:
        return bug(`not immediate: ${debug_OperandRef(this, PLAIN, debug_V_or_stop(debug_V))}`);
    }
  }

  /// Asserts that this operand is a pointer (or reference) and returns
  /// the place to which it points.  (This requires no code to be emitted
  /// as we represent places using the pointer to the place.)
  ///
  /// This uses [`Ty::builtin_deref`] to include the type of the place and
  /// assumes the place is aligned to the pointee's usual ABI alignment.
  ///
  /// If you don't need the type, see [`OperandValue::pointer_parts`]
  /// or [`OperandValue::deref`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:298 deref
  deref<B extends BackendTypes>(this: OperandRef<B["Value"]>, cx: CodegenMethods<B>): PlaceRef<B["Value"]> {
    if (this.layout.ty.is_box()) {
      // Derefer should have removed all Box derefs
      return bug(`dereferencing ${debug_Ty(this.layout.ty, PLAIN)} in codegen`);
    }

    const projected_ty = this.layout.ty.builtin_deref(true) ?? bug(`deref of non-pointer ${debug_OperandRef(this, PLAIN, cx.debug_Value)}`);

    const layout = cx.layout_of(projected_ty);
    return OperandValue.deref(this.val, layout.align.abi, cx.debug_Value).with_type(layout, cx.debug_Value);
  }

  /// Store this operand into a place, applying move/copy annotation if present.
  ///
  /// This is the preferred method for storing operands, as it automatically
  /// applies profiler annotations for tracked move/copy operations.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:318 store_with_annotation
  store_with_annotation<B extends BackendTypes>(this: OperandRef<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void {
    this.store_with_annotation_and_flags(bx, dest, MemFlags.empty());
  }

  /// Same as store_with_annotation(), but also specify flags for the store.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:327 store_with_annotation_and_flags
  store_with_annotation_and_flags<B extends BackendTypes>(
    this: OperandRef<B["Value"]>,
    bx: BuilderMethods<B>,
    dest: PlaceRef<B["Value"]>,
    flags: MemFlags,
  ): void {
    const instance = this.move_annotation;
    if (instance !== undefined) {
      bx.with_move_annotation(instance, (bx) => OperandValue.store_with_flags(this.val, bx, dest, flags));
    } else {
      OperandValue.store_with_flags(this.val, bx, dest, flags);
    }
  }

  /// If this operand is a `Pair`, we return an aggregate with the two values.
  /// For other cases, see `immediate`.
  ///
  /// Note: The use of this is discouraged outside cg_llvm, as some other backends
  /// don't natively support packing multiple things into one like this.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:345 immediate_or_packed_pair
  immediate_or_packed_pair<B extends BackendTypes>(this: OperandRef<B["Value"]>, bx: BuilderMethods<B>): B["Value"] {
    const val = this.val;
    if (val.$ === "Pair") {
      const a = val._0;
      const b = val._1;
      const llty = bx.cx().immediate_backend_type(this.layout);
      // debug!("Operand::immediate_or_packed_pair: packing {:?} into {:?}", self, llty);
      // Reconstruct the immediate aggregate.
      let llpair = bx.cx().const_poison(llty);
      llpair = bx.insert_value(llpair, a, 0);
      llpair = bx.insert_value(llpair, b, 1);
      return llpair;
    } else {
      return this.immediate(bx.debug_Value);
    }
  }

  /// If the type is a pair, we return a `Pair`, otherwise, an `Immediate`.
  ///
  /// Note: The use of this is discouraged outside cg_llvm, as some other backends
  /// don't natively support packing multiple things into one like this.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:366 from_immediate_or_packed_pair
  static from_immediate_or_packed_pair<B extends BackendTypes>(bx: BuilderMethods<B>, llval: B["Value"], layout: TyAndLayout): OperandRef<B["Value"]> {
    let val: OperandValue<B["Value"]>;
    if (layout.backend_repr.$ === "ScalarPair") {
      // debug!("Operand::from_immediate_or_packed_pair: unpacking {:?} @ {:?}", llval, layout);

      // Deconstruct the immediate aggregate.
      const a_llval = bx.extract_value(llval, 0);
      const b_llval = bx.extract_value(llval, 1);
      val = { $: "Pair", _0: a_llval, _1: b_llval };
    } else {
      val = { $: "Immediate", _0: llval };
    }
    return new OperandRef(val, layout, undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:384 extract_field
  extract_field<B extends BackendTypes>(this: OperandRef<B["Value"]>, fx: FunctionCx<B>, bx: BuilderMethods<B>, i: number): OperandRef<B["Value"]> {
    const field = this.layout.field(bx.cx(), i);
    const offset = FieldsShape.offset(this.layout.fields, i);

    if (this.layout.is_ssa_standalone() && !field.is_ssa_standalone()) {
      // Part of https://github.com/rust-lang/compiler-team/issues/838
      return span_bug(
        fx.mir.span,
        `Standalone type ${debug_OperandRef(this, PLAIN, bx.debug_Value)} cannot project to memory-dependent field type ${format_debug(field, debug_TyAndLayout_Ty, PLAIN)}`,
      );
    }

    let val: OperandValue<B["Value"]>;
    if (field.is_zst()) {
      val = OperandValue.ZeroSized;
    } else if (Size_eq(field.size, this.layout.size)) {
      assert_eq(offset.bytes(), 0, String);
      val = fx.codegen_transmute_operand(bx, this, field);
    } else {
      let in_scalar: abi_Scalar | undefined;
      let imm: B["Value"];
      const self_val = this.val;
      const self_repr = this.layout.backend_repr;
      // Extract a scalar component from a pair.
      if (self_val.$ === "Pair" && self_repr.$ === "ScalarPair") {
        const a_llval = self_val._0;
        const b_llval = self_val._1;
        const { a, b, b_offset } = self_repr;
        if (offset.bytes() === 0) {
          assert_eq(field.size, abi_Scalar.size(a, bx.cx()), (v) => debug_Size(v, PLAIN), Size_eq);
          [in_scalar, imm] = [a, a_llval];
        } else {
          assert_eq(offset, b_offset, (v) => debug_Size(v, PLAIN), Size_eq);
          assert_eq(field.size, abi_Scalar.size(b, bx.cx()), (v) => debug_Size(v, PLAIN), Size_eq);
          [in_scalar, imm] = [b, b_llval];
        }
      } else {
        return span_bug(fx.mir.span, `OperandRef::extract_field(${debug_OperandRef(this, PLAIN, bx.debug_Value)}): not applicable`);
      }
      let out: B["Value"];
      const field_repr = field.backend_repr;
      switch (field_repr.$) {
        case "SimdVector":
          out = imm;
          break;
        case "Scalar": {
          const out_scalar = field_repr._0;
          if (in_scalar === undefined) {
            return span_bug(
              fx.mir.span,
              `OperandRef::extract_field(${debug_OperandRef(this, PLAIN, bx.debug_Value)}): missing input scalar for output scalar`,
            );
          }
          if (!abi_Scalar_eq(in_scalar, out_scalar)) {
            // If the backend and backend_immediate types might differ,
            // flip back to the backend type then to the new immediate.
            // This avoids nop truncations, but still handles things like
            // Bools in union fields needs to be truncated.
            const backend = bx.from_immediate(imm);
            out = bx.to_immediate_scalar(backend, out_scalar);
          } else {
            out = imm;
          }
          break;
        }
        case "ScalarPair":
        case "Memory":
        case "SimdScalableVector":
          return bug();
      }
      val = { $: "Immediate", _0: out };
    }

    return new OperandRef(val, field, undefined);
  }

  /// Obtain the actual discriminant of a value.
  // #[instrument(level = "trace", skip(fx, bx))]
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:459 codegen_get_discr
  codegen_get_discr<B extends BackendTypes>(this: OperandRef<B["Value"]>, fx: FunctionCx<B>, bx: BuilderMethods<B>, cast_to_ty: Ty): B["Value"] {
    const dl = bx.tcx_().data_layout();
    const cast_to_layout = bx.cx().layout_of(cast_to_ty);
    const cast_to = bx.cx().immediate_backend_type(cast_to_layout);

    // We check uninhabitedness separately because a type like
    // `enum Foo { Bar(i32, !) }` is still reported as `Variants::Single`,
    // *not* as `Variants::Empty`.
    if (this.layout.is_uninhabited()) {
      return bx.cx().const_poison(cast_to);
    }

    const self_variants = this.layout.variants;
    let tag_scalar: abi_Scalar;
    let tag_encoding;
    let tag_field: FieldIdx;
    let variants;
    switch (self_variants.$) {
      case "Empty":
        return unreachable("internal error: entered unreachable code: we already handled uninhabited types");
      case "Single": {
        const index = self_variants.index;
        let discr_val: bigint;
        const discr = this.layout.ty.discriminant_for_variant(bx.tcx_(), index);
        if (discr !== undefined) {
          discr_val = discr.val;
        } else {
          // This arm is for types which are neither enums nor coroutines,
          // and thus for which the only possible "variant" should be the first one.
          assert_eq(index, FIRST_VARIANT, String);
          // There's thus no actual discriminant to return, so we return
          // what it would have been if this was a single-variant enum.
          discr_val = 0n;
        }
        return bx.cx().const_uint_big(cast_to, discr_val);
      }
      case "Multiple":
        [tag_scalar, tag_encoding, tag_field, variants] = [self_variants.tag, self_variants.tag_encoding, self_variants.tag_field, self_variants.variants];
        break;
    }

    // Read the tag/niche-encoded discriminant from memory.
    let tag_op: OperandRef<B["Value"]>;
    const self_val = this.val;
    switch (self_val.$) {
      case "ZeroSized":
        return bug();
      case "Immediate":
      case "Pair":
        tag_op = this.extract_field(fx, bx, tag_field);
        break;
      case "Ref": {
        const place = self_val._0;
        const tag = place.with_type(this.layout, bx.debug_Value).project_field(bx, tag_field);
        tag_op = bx.load_operand(tag);
        break;
      }
    }
    const tag_imm = tag_op.immediate(bx.debug_Value);

    // Decode the discriminant (specifically if it's niche-encoded).
    if (tag_encoding.$ === "Direct") {
      let signed: boolean;
      const prim = abi_Scalar.primitive(tag_scalar);
      switch (prim.$) {
        // We use `i1` for bytes that are always `0` or `1`,
        // e.g., `#[repr(i8)] enum E { A, B }`, but we can't
        // let LLVM interpret the `i1` as signed, because
        // then `i1 1` (i.e., `E::B`) is effectively `i8 -1`.
        case "Int":
          signed = !abi_Scalar.is_bool(tag_scalar) && prim._1;
          break;
        default:
          signed = false;
      }
      if (bx.cx().sess().opts.optimize !== "No") {
        const vals: bigint[] = [];
        for (let idx = 0; idx < variants.length; idx++) {
          const layout = variants[idx]!;
          if (!layout.is_uninhabited()) {
            vals.push(unwrap(this.layout.ty.discriminant_for_variant(bx.tcx_(), idx as VariantIdx)).val);
          }
        }
        // Recording all possible discriminant values using `assume(v == c1 || v == c2 || v == c3)` may introduce
        // additional compile-time overhead, but we can use `assume(ctpop(v) == 1)` when all possible values are known to be powers of two.
        // PORT: `u128::is_power_of_two`.
        if (vals.every((val) => val !== 0n && (val & (val - 1n)) === 0n)) {
          const one = bx.cx().const_i32(1);
          const ctpop = bx.ctpop(tag_imm);
          const is_one = bx.icmp(IntPredicate.IntEQ, ctpop, one);
          bx.assume(is_one);
        }
      }
      return bx.intcast(tag_imm, cast_to, signed);
    } else {
      const { untagged_variant, niche_variants, niche_start } = tag_encoding;
      // Cast to an integer so we don't have to treat a pointer as a
      // special case.
      let tag: B["Value"];
      let tag_llty: B["Type"];
      if (abi_Scalar.primitive(tag_scalar).$ === "Pointer") {
        // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
        const t = bx.type_from_integer(dl.ptr_sized_integer());
        const tag_ = bx.ptrtoint(tag_imm, t);
        [tag, tag_llty] = [tag_, t];
      } else {
        [tag, tag_llty] = [tag_imm, bx.cx().immediate_backend_type(tag_op.layout)];
      }

      // `layout_sanity_check` ensures that we only get here for cases where the discriminant
      // value and the variant index match, since that's all `Niche` can encode.

      // PORT: `u32` subtraction; rustc builds without overflow checks, so it wraps (`>>> 0`).
      const relative_max = (niche_variants.last - niche_variants.start) >>> 0;
      const niche_start_const = bx.cx().const_uint_big(tag_llty, niche_start);

      // We have a subrange `niche_start..=niche_end` inside `range`.
      // If the value of the tag is inside this subrange, it's a
      // "niche value", an increment of the discriminant. Otherwise it
      // indicates the untagged variant.
      // A general algorithm to extract the discriminant from the tag
      // is:
      // relative_tag = tag - niche_start
      // is_niche = relative_tag <= (ule) relative_max
      // discr = if is_niche {
      //     cast(relative_tag) + niche_variants.start()
      // } else {
      //     untagged_variant
      // }
      // However, we will likely be able to emit simpler code.
      let is_niche: B["Value"];
      let tagged_discr: B["Value"];
      let delta: bigint;
      if (relative_max === 0) {
        // Best case scenario: only one tagged variant. This will
        // likely become just a comparison and a jump.
        // The algorithm is:
        // is_niche = tag == niche_start
        // discr = if is_niche {
        //     niche_start
        // } else {
        //     untagged_variant
        // }
        const is_niche_ = bx.icmp(IntPredicate.IntEQ, tag, niche_start_const);
        const tagged_discr_ = bx.cx().const_uint(cast_to, BigInt(niche_variants.start));
        [is_niche, tagged_discr, delta] = [is_niche_, tagged_discr_, 0n];
      } else {
        // Thanks to parameter attributes and load metadata, LLVM already knows
        // the general valid range of the tag. It's possible, though, for there
        // to be an impossible value *in the middle*, which those ranges don't
        // communicate, so it's worth an `assume` to let the optimizer know.
        // Most importantly, this means when optimizing a variant test like
        // `SELECT(is_niche, complex, CONST) == CONST` it's ok to simplify that
        // to `!is_niche` because the `complex` part can't possibly match.
        //
        // This was previously asserted on `tagged_discr` below, where the
        // impossible value is more obvious, but that caused an intermediate
        // value to become multi-use and thus not optimize, so instead this
        // assumes on the original input which is always multi-use. See
        // <https://github.com/llvm/llvm-project/issues/134024#issuecomment-3131782555>
        //
        // FIXME: If we ever get range assume operand bundles in LLVM (so we
        // don't need the `icmp`s in the instruction stream any more), it
        // might be worth moving this back to being on the switch argument
        // where it's more obviously applicable.
        // PORT: `RangeInclusive::contains`.
        if (niche_variants.start <= untagged_variant && untagged_variant <= niche_variants.last && bx.cx().sess().opts.optimize !== "No") {
          let impossible = BigInt.asUintN(128, niche_start + BigInt(untagged_variant));
          impossible = BigInt.asUintN(128, impossible - BigInt(niche_variants.start));
          const impossible_ = bx.cx().const_uint_big(tag_llty, impossible);
          const ne = bx.icmp(IntPredicate.IntNE, tag, impossible_);
          bx.assume(ne);
        }

        // With multiple niched variants we'll have to actually compute
        // the variant index from the stored tag.
        //
        // However, there's still one small optimization we can often do for
        // determining *whether* a tag value is a natural value or a niched
        // variant. The general algorithm involves a subtraction that often
        // wraps in practice, making it tricky to analyse. However, in cases
        // where there are few enough possible values of the tag that it doesn't
        // need to wrap around, we can instead just look for the contiguous
        // tag values on the end of the range with a single comparison.
        //
        // For example, take the type `enum Demo { A, B, Untagged(bool) }`.
        // The `bool` is {0, 1}, and the two other variants are given the
        // tags {2, 3} respectively. That means the `tag_range` is
        // `[0, 3]`, which doesn't wrap as unsigned (nor as signed), so
        // we can test for the niched variants with just `>= 2`.
        //
        // That means we're looking either for the niche values *above*
        // the natural values of the untagged variant:
        //
        //             niche_start                  niche_end
        //                  |                           |
        //                  v                           v
        // MIN -------------+---------------------------+---------- MAX
        //         ^        |         is niche          |
        //         |        +---------------------------+
        //         |                                    |
        //   tag_range.start                      tag_range.end
        //
        // Or *below* the natural values:
        //
        //    niche_start              niche_end
        //         |                       |
        //         v                       v
        // MIN ----+-----------------------+---------------------- MAX
        //         |       is niche        |           ^
        //         +-----------------------+           |
        //         |                                   |
        //   tag_range.start                      tag_range.end
        //
        // With those two options and having the flexibility to choose
        // between a signed or unsigned comparison on the tag, that
        // covers most realistic scenarios. The tests have a (contrived)
        // example of a 1-byte enum with over 128 niched variants which
        // wraps both as signed as unsigned, though, and for something
        // like that we're stuck with the general algorithm.

        const tag_range = abi_Scalar.valid_range(tag_scalar, dl);
        const tag_size = abi_Scalar.size(tag_scalar, dl);
        let niche_end = BigInt.asUintN(128, BigInt(relative_max) + niche_start);
        niche_end = tag_size.truncate(niche_end);

        const relative_discr = bx.sub(tag, niche_start_const);
        const cast_tag = bx.intcast(relative_discr, cast_to, false);
        let is_niche_: B["Value"];
        const no_unsigned = tag_range.no_unsigned_wraparound(tag_size);
        const no_signed = (): boolean => {
          const r = tag_range.no_signed_wraparound(tag_size);
          return r.$ === "Ok" && r._0;
        };
        if (no_unsigned.$ === "Ok" && no_unsigned._0) {
          if (niche_start === tag_range.start) {
            const niche_end_const = bx.cx().const_uint_big(tag_llty, niche_end);
            is_niche_ = bx.icmp(IntPredicate.IntULE, tag, niche_end_const);
          } else {
            assert_eq(niche_end, tag_range.end, String);
            is_niche_ = bx.icmp(IntPredicate.IntUGE, tag, niche_start_const);
          }
        } else if (no_signed()) {
          if (niche_start === tag_range.start) {
            const niche_end_const = bx.cx().const_uint_big(tag_llty, niche_end);
            is_niche_ = bx.icmp(IntPredicate.IntSLE, tag, niche_end_const);
          } else {
            assert_eq(niche_end, tag_range.end, String);
            is_niche_ = bx.icmp(IntPredicate.IntSGE, tag, niche_start_const);
          }
        } else {
          is_niche_ = bx.icmp(IntPredicate.IntULE, relative_discr, bx.cx().const_uint(tag_llty, BigInt(relative_max)));
        }

        [is_niche, tagged_discr, delta] = [is_niche_, cast_tag, BigInt(niche_variants.start)];
      }

      if (delta !== 0n) {
        tagged_discr = bx.add(tagged_discr, bx.cx().const_uint_big(cast_to, delta));
      }

      const untagged_variant_const = bx.cx().const_uint(cast_to, BigInt(untagged_variant));

      const discr = bx.select(is_niche, tagged_discr, untagged_variant_const);

      // In principle we could insert assumes on the possible range of `discr`, but
      // currently in LLVM this isn't worth it because the original `tag` will
      // have either a `range` parameter attribute or `!range` metadata,
      // or come from a `transmute` that already `assume`d it.

      return discr;
    }
  }
}

// impl<V: CodegenObject> fmt::Debug for OperandRef<'_, V>
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:163 fmt
export function debug_OperandRef<V>(self: OperandRef<V>, f: Fmt, debug_V: Debug<V>): string {
  // PORT: `write!(f, "OperandRef({:?} @ {:?})", ..)` does not forward the caller's `#`; the inner `{:?}` are plain.
  void f;
  return `OperandRef(${debug_OperandValue(self.val, PLAIN, debug_V)} @ ${format_debug(self.layout, debug_TyAndLayout_Ty, PLAIN)})`;
}

/// Each of these variants starts out as `Either::Right` when it's uninitialized,
/// then setting the field changes that to `Either::Left` with the backend value.
// #[derive(Debug, Copy, Clone)]
type OperandValueBuilder<V> =
  | { readonly $: "ZeroSized" }
  | { readonly $: "Immediate"; _0: Either<V, abi_Scalar> }
  | { readonly $: "Pair"; _0: Either<V, abi_Scalar>; _1: Either<V, abi_Scalar> }
  /// `repr(simd)` types need special handling because they each have a non-empty
  /// array field (which uses [`OperandValue::Ref`]) despite the SIMD type itself
  /// using [`OperandValue::Immediate`] which for any other kind of type would
  /// mean that its one non-ZST field would also be [`OperandValue::Immediate`].
  | { readonly $: "Vector"; _0: Either<V, undefined> };
// PORT: the builder is a value owned by its `OperandRefBuilder`; `match &mut self.val` arms write its `Either` slots
// in place (the `_0`/`_1` fields are mutable for that; no copy of a builder is ever shared).

function debug_Either<L, R>(v: Either<L, R>, f: Fmt, debug_L: Debug<L>, debug_R: Debug<R>): string {
  return v.$ === "Left" ? debug_tuple(f, "Left", [debug_L(v._0, f)]) : debug_tuple(f, "Right", [debug_R(v._0, f)]);
}
const debug_unit: Debug<undefined> = () => "()";

// derive(Debug)
function debug_OperandValueBuilder<V>(v: OperandValueBuilder<V>, f: Fmt, debug_V: Debug<V>): string {
  switch (v.$) {
    case "ZeroSized":
      return "ZeroSized";
    case "Immediate":
      return debug_tuple(f, "Immediate", [debug_Either(v._0, f, debug_V, abi_Scalar_debug)]);
    case "Pair":
      return debug_tuple(f, "Pair", [debug_Either(v._0, f, debug_V, abi_Scalar_debug), debug_Either(v._1, f, debug_V, abi_Scalar_debug)]);
    case "Vector":
      return debug_tuple(f, "Vector", [debug_Either(v._0, f, debug_V, debug_unit)]);
  }
}

/// Allows building up an `OperandRef` by setting fields one at a time.
// #[derive(Debug, Copy, Clone)]
export class OperandRefBuilder<V> {
  constructor(
    private val: OperandValueBuilder<V>,
    private layout: TyAndLayout,
  ) {}

  /// Creates an uninitialized builder for an instance of the `layout`.
  ///
  /// ICEs for [`BackendRepr::Memory`] types (other than ZSTs), which should
  /// be built up inside a [`PlaceRef`] instead as they need an allocated place
  /// into which to write the values of the fields.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:748 new
  static new<V>(layout: TyAndLayout): OperandRefBuilder<V> {
    let val: OperandValueBuilder<V>;
    const repr = layout.backend_repr;
    if (repr.$ === "Memory" && layout.is_zst()) {
      val = { $: "ZeroSized" };
    } else if (repr.$ === "Scalar") {
      val = { $: "Immediate", _0: { $: "Right", _0: repr._0 } };
    } else if (repr.$ === "ScalarPair") {
      val = { $: "Pair", _0: { $: "Right", _0: repr.a }, _1: { $: "Right", _0: repr.b } };
    } else if (repr.$ === "SimdVector" || repr.$ === "SimdScalableVector") {
      val = { $: "Vector", _0: { $: "Right", _0: undefined } };
    } else {
      return bug(`Cannot use non-ZST Memory-ABI type in operand builder: ${format_debug(layout, debug_TyAndLayout_Ty, PLAIN)}`);
    }
    return new OperandRefBuilder(val, layout);
  }

  /// Creates an initialized builder for updating an existing `operand`.
  ///
  /// ICEs for [`BackendRepr::Memory`] types (other than ZSTs), which use
  /// which use [`OperandValue::Ref`]. In this case, updates should be
  /// performed by writing into the place
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:770 from_existing
  static from_existing<V>(operand: OperandRef<V>, debug_V?: Debug<V>): OperandRefBuilder<V> {
    const layout = operand.layout;
    let val: OperandValueBuilder<V>;
    const ov = operand.val;
    const repr = layout.backend_repr;
    if (ov.$ === "ZeroSized") {
      val = { $: "ZeroSized" };
    } else if (ov.$ === "Immediate" && repr.$ === "Scalar") {
      val = { $: "Immediate", _0: { $: "Left", _0: ov._0 } };
    } else if (ov.$ === "Immediate" && repr.$ === "SimdVector") {
      val = { $: "Vector", _0: { $: "Left", _0: ov._0 } };
    } else if (ov.$ === "Pair" && repr.$ === "ScalarPair") {
      val = { $: "Pair", _0: { $: "Left", _0: ov._0 }, _1: { $: "Left", _0: ov._1 } };
    } else if (repr.$ === "Memory") {
      return bug(`Cannot use non-ZST Memory-ABI type in operand builder: ${format_debug(layout, debug_TyAndLayout_Ty, PLAIN)}`);
    } else {
      return bug(`Operand cannot be used with \`from_existing\`: ${debug_OperandRef(operand, PLAIN, debug_V_or_stop(debug_V))}`);
    }
    return new OperandRefBuilder(val, layout);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:793 insert_field
  insert_field<B extends BackendTypes>(
    this: OperandRefBuilder<B["Value"]>,
    bx: BuilderMethods<B>,
    variant: VariantIdx,
    field: FieldIdx,
    field_operand: OperandRef<B["Value"]>,
  ): void {
    if (field_operand.val.$ === "ZeroSized") {
      // A ZST never adds any state, so just ignore it.
      // This special-casing is worth it because of things like
      // `Result<!, !>` where `Ok(never)` is legal to write,
      // but the type shows as FieldShape::Primitive so we can't
      // actually look at the layout for the field being set.
      return;
    }

    let is_zero_offset: boolean;
    if (this.layout.fields.$ === "Primitive") {
      // The other branch looking at field layouts ICEs for primitives,
      // so we need to handle them separately.
      // Because we handled ZSTs above (like the metadata in a thin pointer),
      // the only possibility is that we're setting the one-and-only field.
      assert(!this.layout.is_zst(), "assertion failed: !self.layout.is_zst()");
      assert_eq(variant, FIRST_VARIANT, String);
      assert_eq(field, 0 as FieldIdx, String);
      is_zero_offset = true;
    } else {
      const variant_layout = this.layout.for_variant(bx.cx(), variant);
      const field_offset = FieldsShape.offset(variant_layout.fields, field);
      is_zero_offset = Size_eq(field_offset, Size.ZERO);
    }

    // PORT: `tgt: &mut Either<V, Scalar>` is the slot's holder and key.
    const update = (tgt: { _0: Either<B["Value"], abi_Scalar>; _1?: Either<B["Value"], abi_Scalar> }, key: "_0" | "_1", src: B["Value"], from_scalar: abi_Scalar): void => {
      const slot = tgt[key]!;
      const to_scalar = slot.$ === "Right" ? slot._0 : unwrap_right_failed(slot, bx.debug_Value);
      // We transmute here (rather than just `from_immediate`) because in
      // `Result<usize, *const ()>` the field of the `Ok` is an integer,
      // but the corresponding scalar in the enum is a pointer.
      const imm = transmute_scalar(bx, src, from_scalar, to_scalar);
      tgt[key] = { $: "Left", _0: imm };
    };

    const fov = field_operand.val;
    const frepr = field_operand.layout.backend_repr;
    const self_val = this.val;
    const tried = (): never =>
      bug(
        `Tried to insert ${debug_OperandRef(field_operand, PLAIN, bx.debug_Value)} into ${String(variant)}.${String(field)} of ${debug_OperandRefBuilder(this, PLAIN, bx.debug_Value)}`,
      );
    if (fov.$ === "Immediate" && frepr.$ === "Scalar") {
      const v = fov._0;
      const from_scalar = frepr._0;
      if (self_val.$ === "Immediate" && self_val._0.$ === "Right" && is_zero_offset) {
        update(self_val, "_0", v, from_scalar);
      } else if (self_val.$ === "Pair" && self_val._0.$ === "Right" && is_zero_offset) {
        update(self_val, "_0", v, from_scalar);
      } else if (self_val.$ === "Pair" && self_val._1.$ === "Right" && !is_zero_offset) {
        update(self_val, "_1", v, from_scalar);
      } else {
        tried();
      }
    } else if (fov.$ === "Immediate" && frepr.$ === "SimdVector") {
      const v = fov._0;
      if (self_val.$ === "Vector" && self_val._0.$ === "Right" && is_zero_offset) {
        self_val._0 = { $: "Left", _0: v };
      } else {
        tried();
      }
    } else if (fov.$ === "Pair" && frepr.$ === "ScalarPair") {
      const [a, b] = [fov._0, fov._1];
      const { a: from_sa, b: from_sb } = frepr;
      if (self_val.$ === "Pair" && self_val._0.$ === "Right" && self_val._1.$ === "Right") {
        update(self_val, "_0", a, from_sa);
        update(self_val, "_1", b, from_sb);
      } else {
        tried();
      }
    } else if (fov.$ === "Ref" && frepr.$ === "Memory") {
      const place = fov._0;
      if (self_val.$ === "Vector" && self_val._0.$ === "Right") {
        const ibty = bx.cx().immediate_backend_type(this.layout);
        const simd = bx.load_from_place(ibty, place);
        self_val._0 = { $: "Left", _0: simd };
      } else {
        tried();
      }
    } else {
      bug(`Operand cannot be used with \`insert_field\`: ${debug_OperandRef(field_operand, PLAIN, bx.debug_Value)}`);
    }
  }

  /// Insert the immediate value `imm` for field `f` in the *type itself*,
  /// rather than into one of the variants.
  ///
  /// Most things want [`Self::insert_field`] instead, but this one is
  /// necessary for writing things like enum tags that aren't in any variant.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:888 insert_imm
  insert_imm(f: FieldIdx, imm: V, debug_V?: Debug<V>): void {
    const field_offset = FieldsShape.offset(this.layout.fields, f);
    const is_zero_offset = Size_eq(field_offset, Size.ZERO);
    const val = this.val;
    if (val.$ === "Immediate" && val._0.$ === "Right" && is_zero_offset) {
      val._0 = { $: "Left", _0: imm };
    } else if (val.$ === "Pair" && val._0.$ === "Right" && is_zero_offset) {
      val._0 = { $: "Left", _0: imm };
    } else if (val.$ === "Pair" && val._1.$ === "Right" && !is_zero_offset) {
      val._1 = { $: "Left", _0: imm };
    } else {
      const d = debug_V_or_stop(debug_V);
      bug(`Tried to insert ${d(imm, PLAIN)} into field ${String(f)} of ${debug_OperandRefBuilder(this, PLAIN, d)}`);
    }
  }

  /// Replaces the current immediate value at the offset `offset`
  /// with the value `imm`. A value must already be present.
  ///
  /// This is used along with [`Self::from_existing`] to perform in-place updates
  /// of any operand.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:910 update_imm
  update_imm(offset: Size, imm: V, debug_V?: Debug<V>): void {
    const is_zero_offset = Size_eq(offset, Size.ZERO);
    const val = this.val;
    if (val.$ === "Immediate" && val._0.$ === "Left" && is_zero_offset) {
      val._0 = { $: "Left", _0: imm };
    } else if (val.$ === "Pair" && val._0.$ === "Left" && is_zero_offset) {
      val._0 = { $: "Left", _0: imm };
    } else if (val.$ === "Pair" && val._1.$ === "Left" && !is_zero_offset) {
      val._1 = { $: "Left", _0: imm };
    } else {
      const d = debug_V_or_stop(debug_V);
      bug(`Tried to update ${d(imm, PLAIN)} at offset ${debug_Size(offset, PLAIN)} of ${debug_OperandRefBuilder(this, PLAIN, d)}`);
    }
  }

  /// After having set all necessary fields, this converts the builder back
  /// to the normal `OperandRef`.
  ///
  /// ICEs if any required fields were not set.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:930 build
  build<B extends BackendTypes>(this: OperandRefBuilder<B["Value"]>, cx: CodegenMethods<B>): OperandRef<B["Value"]> {
    const { val, layout } = this;

    // For something like `Option::<u32>::None`, it's expected that the
    // payload scalar will not actually have been set, so this converts
    // unset scalars to corresponding `undef` values so long as the scalar
    // from the layout allows uninit.
    const unwrap_ = (r: Either<B["Value"], abi_Scalar>): B["Value"] => {
      if (r.$ === "Left") {
        return r._0;
      } else if (abi_Scalar.is_uninit_valid(r._0)) {
        const bty = cx.type_from_scalar(r._0);
        return cx.const_undef(bty);
      } else {
        return bug(`OperandRef::build called while fields are missing ${debug_OperandRefBuilder(this, PLAIN, cx.debug_Value)}`);
      }
    };

    let val_: OperandValue<B["Value"]>;
    switch (val.$) {
      case "ZeroSized":
        val_ = OperandValue.ZeroSized;
        break;
      case "Immediate":
        val_ = { $: "Immediate", _0: unwrap_(val._0) };
        break;
      case "Pair":
        val_ = { $: "Pair", _0: unwrap_(val._0), _1: unwrap_(val._1) };
        break;
      case "Vector": {
        const v = val._0;
        const repr = layout.backend_repr;
        if (v.$ === "Left") {
          val_ = { $: "Immediate", _0: v._0 };
        } else if (repr.$ === "SimdVector" && abi_Scalar.is_uninit_valid(repr.element)) {
          const bty = cx.immediate_backend_type(layout);
          val_ = { $: "Immediate", _0: cx.const_undef(bty) };
        } else {
          return bug(`OperandRef::build called while fields are missing ${debug_OperandRefBuilder(this, PLAIN, cx.debug_Value)}`);
        }
        break;
      }
    }
    return new OperandRef(val_, layout, undefined);
  }

  /** derive(Debug) access to the private fields. */
  static fields<V>(b: OperandRefBuilder<V>): [OperandValueBuilder<V>, TyAndLayout] {
    return [b.val, b.layout];
  }
}
// derive(Debug)
function debug_OperandRefBuilder<V>(v: OperandRefBuilder<V>, f: Fmt, debug_V: Debug<V>): string {
  const [val, layout] = OperandRefBuilder.fields(v);
  return debug_struct(f, "OperandRefBuilder", [
    ["val", debug_OperandValueBuilder(val, f, debug_V)],
    ["layout", debug_TyAndLayout_Ty(layout, f)],
  ]);
}

/** `Either::unwrap_right` on a `Left` (either-1.15.0 src/lib.rs:847). */
function unwrap_right_failed<V>(slot: { readonly $: "Left"; _0: V }, debug_V: Debug<V>): never {
  return panic(`called \`Either::unwrap_right()\` on a \`Left\` value: ${debug_V(slot._0, PLAIN)}`);
}

/// Default size limit for move/copy annotations (in bytes). 64 bytes is a common size of a cache
/// line, and the assumption is that anything this size or below is very cheap to move/copy, so only
/// annotate copies larger than this.
const MOVE_ANNOTATION_DEFAULT_LIMIT: bigint = 65n;

/// Returns an `OperandValue` that's generally UB to use in any way.
///
/// Depending on the `layout`, returns `ZeroSized` for ZSTs, an `Immediate` or
/// `Pair` containing poison value(s), or a `Ref` containing a poison pointer.
///
/// Supports sized types only.
// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:980 poison
OperandValue.poison = function <B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout): OperandValue<B["Value"]> {
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");
  const repr = layout.backend_repr;
  if (layout.is_zst()) {
    return OperandValue.ZeroSized;
  } else if (repr.$ === "Scalar" || repr.$ === "SimdVector" || repr.$ === "SimdScalableVector") {
    const ibty = bx.cx().immediate_backend_type(layout);
    return { $: "Immediate", _0: bx.const_poison(ibty) };
  } else if (repr.$ === "ScalarPair") {
    const ibty0 = bx.cx().scalar_pair_element_backend_type(layout, 0, true);
    const ibty1 = bx.cx().scalar_pair_element_backend_type(layout, 1, true);
    return { $: "Pair", _0: bx.const_poison(ibty0), _1: bx.const_poison(ibty1) };
  } else {
    // BackendRepr::Memory { .. }
    const ptr = bx.cx().type_ptr();
    return { $: "Ref", _0: PlaceValue.new_sized(bx.const_poison(ptr), layout.align.abi) };
  }
};

// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1005 store
OperandValue.store = function <B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void {
  OperandValue.store_with_flags(self, bx, dest, MemFlags.empty());
};

// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1013 volatile_store
OperandValue.volatile_store = function <B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void {
  OperandValue.store_with_flags(self, bx, dest, MemFlags.VOLATILE);
};

// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1021 nontemporal_store
OperandValue.nontemporal_store = function <B extends BackendTypes>(self: OperandValue<B["Value"]>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>): void {
  OperandValue.store_with_flags(self, bx, dest, MemFlags.NONTEMPORAL);
};

// rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1029 store_with_flags
OperandValue.store_with_flags = function <B extends BackendTypes>(
  self: OperandValue<B["Value"]>,
  bx: BuilderMethods<B>,
  dest: PlaceRef<B["Value"]>,
  flags: MemFlags,
): void {
  // debug!("OperandRef::store: operand={:?}, dest={:?}", self, dest);
  switch (self.$) {
    case "ZeroSized":
      // Avoid generating stores of zero-sized values, because the only way to have a
      // zero-sized value is through `undef`/`poison`, and the store itself is useless.
      break;
    case "Ref": {
      const val = self._0;
      assert(dest.layout.is_sized(), "cannot directly store unsized values");
      if (val.llextra !== undefined) {
        bug("cannot directly store unsized values");
      }
      bx.typed_place_copy_with_flags(dest.val, val, dest.layout, flags);
      break;
    }
    case "Immediate": {
      const s = self._0;
      const val = bx.from_immediate(s);
      bx.store_with_flags(val, dest.val.llval, dest.val.align, flags);
      break;
    }
    case "Pair": {
      const a = self._0;
      const b = self._1;
      const repr = dest.layout.backend_repr;
      if (repr.$ !== "ScalarPair") {
        bug(`store_with_flags: invalid ScalarPair layout: ${format_debug(dest.layout, debug_TyAndLayout_Ty, PRETTY)}`);
      }
      const b_offset = repr.b_offset;

      let val = bx.from_immediate(a);
      let align = dest.val.align;
      bx.store_with_flags(val, dest.val.llval, align, flags);

      const llptr = bx.inbounds_ptradd(dest.val.llval, bx.const_usize(b_offset.bytes_u64()));
      val = bx.from_immediate(b);
      align = dest.val.align.restrict_for_offset(b_offset);
      // The CAPTURES_READ_ONLY flag only applies to the first element.
      // PORT: bitflags' `!` truncates to the known flags; `flags` holds only known flags, so `& ~` is the same.
      bx.store_with_flags(val, llptr, align, flags & ~MemFlags.CAPTURES_READ_ONLY);
      break;
    }
  }
};

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    maybe_codegen_consume_direct(bx: Bx, place_ref: mir_PlaceRef): OperandRef<B["Value"]> | undefined;
    codegen_consume(bx: Bx, place_ref: mir_PlaceRef): OperandRef<B["Value"]>;
    codegen_operand(bx: Bx, operand: mir_Operand): OperandRef<B["Value"]>;
    move_copy_annotation_instance(bx: Bx, place: mir_PlaceRef, kind: LangItem): Instance | undefined;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of operand.rs; mod.ts calls this once,
 *  right after its `class FunctionCx` (header). */
export function install_FunctionCx_operand(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1073 maybe_codegen_consume_direct
  FunctionCx_.prototype.maybe_codegen_consume_direct = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place_ref: mir_PlaceRef,
  ): OperandRef<unknown> | undefined {
    // debug!("maybe_codegen_consume_direct(place_ref={:?})", place_ref);

    const local_ref = this.locals.index(place_ref.local);
    switch (local_ref.$) {
      case "Operand": {
        let o = local_ref._0;
        // We only need to handle the projections that
        // `LocalAnalyzer::process_place` let make it here.
        for (const elem of place_ref.projection) {
          switch (elem.$) {
            case "Field": {
              const f = elem._0;
              const o_ = o;
              assert(
                !o.layout.ty.is_any_ptr(),
                () =>
                  `Bad PlaceRef: destructing pointers should use cast/PtrMetadata, but tried to access field ${String(f)} of pointer ${debug_OperandRef(o_, PLAIN, bx.debug_Value)}`,
              );
              o = o.extract_field(this, bx, f);
              break;
            }
            case "Downcast": {
              const vidx = elem._1;
              // debug_assert_eq!(o.layout.variants, abi::Variants::Single { index: vidx });
              const layout = o.layout.for_variant(bx.cx(), vidx);
              o = new OperandRef(o.val, layout, o.move_annotation);
              break;
            }
            default:
              return undefined;
          }
        }

        return o;
      }
      case "PendingOperand":
        return bug(`use of ${debug_mir_PlaceRef(place_ref, PLAIN)} before def`);
      case "Place":
      case "UnsizedPlace":
        // watch out for locals that do not have an
        // alloca; they are handled somewhat differently
        return undefined;
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1119 codegen_consume
  FunctionCx_.prototype.codegen_consume = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place_ref: mir_PlaceRef,
  ): OperandRef<unknown> {
    // debug!("codegen_consume(place_ref={:?})", place_ref);

    const ty = this.monomorphized_place_ty(place_ref);
    const layout = bx.cx().layout_of(ty);

    // ZSTs don't require any actual memory access.
    if (layout.is_zst()) {
      return OperandRef.zero_sized(layout);
    }

    const o = this.maybe_codegen_consume_direct(bx, place_ref);
    if (o !== undefined) {
      return o;
    }

    // for most places, to consume them we just load them
    // out from their home
    const place = this.codegen_place(bx, place_ref);
    return bx.load_operand(place);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1144 codegen_operand
  FunctionCx_.prototype.codegen_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    operand: mir_Operand,
  ): OperandRef<unknown> {
    // debug!("codegen_operand(operand={:?})", operand);

    switch (operand.$) {
      case "Copy":
      case "Move": {
        const place = operand._0;
        let kind: LangItem;
        switch (operand.$) {
          case "Move":
            kind = LangItem.CompilerMove;
            break;
          case "Copy":
            kind = LangItem.CompilerCopy;
            break;
        }

        // Check if we should annotate this move/copy for profiling
        const move_annotation = this.move_copy_annotation_instance(bx, place.as_ref(), kind);

        const o = this.codegen_consume(bx, place.as_ref());
        return new OperandRef(o.val, o.layout, move_annotation);
      }

      case "RuntimeChecks": {
        const checks = operand._0;
        const layout = bx.layout_of(bx.tcx_().types.bool);
        const repr = layout.backend_repr;
        if (repr.$ !== "Scalar") {
          return bug(`from_const: invalid ByVal layout: ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)}`);
        }
        const scalar = repr._0;
        const x = Scalar.from_bool<CtfeProvenance>(RuntimeChecks.value(checks, bx.tcx_().sess));
        const llval = bx.scalar_to_backend(x, scalar, bx.immediate_backend_type(layout));
        const val: OperandValue<unknown> = { $: "Immediate", _0: llval };
        return new OperandRef(val, layout, undefined);
      }

      case "Constant": {
        const constant = operand._0;
        const constant_ty = this.monomorphize(constant.ty(), fold_Ty);
        // Most SIMD vector constants should be passed as immediates.
        // (In particular, some intrinsics really rely on this.)
        if (constant_ty.is_simd()) {
          // However, some SIMD types do not actually use the vector ABI
          // (in particular, packed SIMD types do not). Ensure we exclude those.
          //
          // We also have to exclude vectors of pointers because `immediate_const_vector`
          // does not work for those.
          const layout = bx.layout_of(constant_ty);
          const [, element_ty] = constant_ty.simd_size_and_type(bx.tcx_());
          if (layout.backend_repr.$ === "SimdVector" && element_ty.is_numeric()) {
            const [llval, ty] = this.immediate_const_vector(bx, constant);
            return new OperandRef<unknown>({ $: "Immediate", _0: llval }, bx.layout_of(ty), undefined);
          }
        }
        return this.eval_mir_constant_to_operand(bx, constant);
      }
    }
  };

  /// Creates an `Instance` for annotating a move/copy operation at codegen time.
  ///
  /// Returns `Some(instance)` if the operation should be annotated with debug info, `None`
  /// otherwise. The instance represents a monomorphized `compiler_move<T, SIZE>` or
  /// `compiler_copy<T, SIZE>` function that can be used to create debug scopes.
  ///
  /// There are a number of conditions that must be met for an annotation to be created, but aside
  /// from the basics (annotation is enabled, we're generating debuginfo), the primary concern is
  /// moves/copies which could result in a real `memcpy`. So we check for the size limit, but also
  /// that the underlying representation of the type is in memory.
  // rustc: compiler/rustc_codegen_ssa/src/mir/operand.rs:1214 move_copy_annotation_instance
  FunctionCx_.prototype.move_copy_annotation_instance = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place: mir_PlaceRef,
    kind: LangItem,
  ): Instance | undefined {
    const tcx = bx.tcx_();
    const sess = tcx.sess;

    // Skip if we're not generating debuginfo
    if (sess.opts.debuginfo === "None") {
      return undefined;
    }

    // Check if annotation is enabled and get size limit (otherwise skip)
    let size_limit: bigint;
    const annotate_moves = sess.opts.unstable_opts.annotate_moves;
    if (annotate_moves.$ === "Disabled") {
      return undefined;
    } else if (annotate_moves._0 === undefined) {
      size_limit = MOVE_ANNOTATION_DEFAULT_LIMIT;
    } else {
      const limit = annotate_moves._0;
      size_limit = limit;
    }

    const ty = this.monomorphized_place_ty(place);
    const layout = bx.cx().layout_of(ty);
    const ty_size = layout.size.bytes_u64();

    // Only annotate if type has a memory representation and exceeds size limit (and has a
    // non-zero size)
    if (layout.is_zst() || ty_size < size_limit || layout.backend_repr.$ !== "Memory") {
      return undefined;
    }

    // Look up the DefId for compiler_move or compiler_copy lang item
    const def_id = tcx.lang_items().get(kind);
    if (def_id === undefined) return undefined;

    // Create generic args: compiler_move<T, SIZE> or compiler_copy<T, SIZE>
    const size_const = Const.from_target_usize(tcx, ty_size);
    const generic_args = tcx.mk_args([ty, size_const]);

    // Create the Instance
    const typing_env = this.mir.typing_env(tcx);
    const instance = Instance.expect_resolve(
      tcx,
      typing_env,
      def_id,
      generic_args,
      DUMMY_SP, // span only used for error messages
    );

    return instance;
  };
}
