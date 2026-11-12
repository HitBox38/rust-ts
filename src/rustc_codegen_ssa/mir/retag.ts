//! Experimental support for emitting retags as function calls in generated code.
//!
//! We attempt to retag every argument and return value of a function, and every rvalue
//! of an assignment. The first step to retagging is to generate a [`RetagPlan`], which
//! describes which pointers within the place or operand can be retagged. Then, we traverse
//! the [`RetagPlan`] to emit the calls.
//
// Port of compiler/rustc_codegen_ssa/src/mir/retag.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// PORT (ssa-mir-rest):
// - `RetagPlan` / `RetagFields` are `$`-tagged unions; `impl RetagPlan` (`for_field`, `build`, `walk_value`, `visit_box`,
//   `emit_retag`, `alloc_ranges`) lives on the companion const `RetagPlan` (PORTING §8). `FxIndexMap` is an
//   insertion-ordered `Map`. Their derived `Debug` is not written: nothing formats a plan, and the `Debug` of `RetagInfo` /
//   `RetagFlags` (lib.ts) is deferred to lane ssa-base (ssa-contract PORT 11).
// - `trait PerByteTracking` (associated fns over `Bx`, no `self`): the interface holds the two required fns and the provided
//   `visit_layout` / `collect` live in `PerByteTracking_provided`, taking the implementor (`Self_`) first (PORTING §8). The
//   unit structs `UnsafeCellRanges` / `UnsafePinnedRanges` are objects implementing it, forwarding the provided fns.
// - `RangeSet<Size>`'s bounds table is `SIZE_RANGE_SET_OPS` below (rustc_abi layout/ty.ts keeps its own copy private).
// - The `impl FunctionCx` block is attached by `install_FunctionCx_retag(FunctionCx)`, as constant.ts's header says.
// - Copies of the `Copy` `OperandRef` that upstream then writes (`variant_op.layout = ..`, :487) build a new `OperandRef`
//   (ssa-operand-place PORT 1, docs/reviews/ssa-operand-place.md N1).
// - `{:?}` of backend values: `with_type`, `from_existing`, `pointer_parts` and `update_imm` get `bx.debug_Value` (review N3).
import {
  debug_FieldsShape,
  FieldIdx,
  FieldsShape,
  Integer,
  Size,
  Size_cmp,
  Size_eq,
  VariantIdx,
} from "../../rustc_abi/lib.ts";
import type { Mutability } from "../../rustc_ast/lib.ts";
import { RangeSet, type RangeSetOps } from "../../rustc_data_structures/range_set.ts";
import { Allocation } from "../../rustc_middle/mir/interpret/allocation.ts";
import { GlobalAlloc } from "../../rustc_middle/mir/interpret/mod.ts";
import type { Rvalue } from "../../rustc_middle/mir/syntax.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_option, format_debug, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable } from "../../std/panic.ts";
import { IntPredicate } from "../common.ts";
import { RetagFlags, type RetagInfo } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";
import { type OperandRef, OperandRef as OperandRefC, OperandRefBuilder, OperandValue } from "./operand.ts";
import { PlaceRef } from "./place.ts";

/** PORT: the `T: Copy + Ord + Default + Add + Sub` table of `RangeSet<Size>` (header). */
const SIZE_RANGE_SET_OPS: RangeSetOps<Size> = {
  default_: () => Size.ZERO,
  cmp: Size_cmp,
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
};

// rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:26 rvalue_needs_retag
export function rvalue_needs_retag(rvalue: Rvalue): boolean {
  // `Ref` has its own internal retagging
  return !(rvalue.$ === "Ref") && !(rvalue.$ === "Use" && rvalue._1 === "No");
}

/// A description of the pointers within a type that need to be retagged.
// #[derive(Debug)]
type RetagPlan<V> =
  /// Indicates that a pointer should be retagged.
  | { readonly $: "EmitRetag"; readonly _0: RetagInfo<V> }
  /// Indicates that one or more fields or variants of this type
  /// contain pointers that need to be retagged.
  | {
      readonly $: "Recurse";
      readonly field_plans: RetagFields<V> | undefined;
      readonly variant_plans: Map<VariantIdx, RetagPlan<V>>;
    };

/// The layout of the fields that need to be retagged.
///
/// This mirrors [`FieldsShape`] but excludes unions,
/// which are never retagged, and primitives, which fall
/// into [`RetagPlan::EmitRetag`].
// #[derive(Debug)]
type RetagFields<V> = { readonly $: "Arbitrary"; readonly _0: Map<FieldIdx, RetagPlan<V>> } | { readonly $: "Array"; readonly _0: RetagPlan<V> };

const RetagPlan = {
  // ---- impl<V> RetagPlan<V> ----

  /// A helper function to move a [`RetagPlan`] into a particular field.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:57 for_field
  for_field<V>(self: RetagPlan<V>, ix: FieldIdx): RetagPlan<V> {
    const field_plans = new Map<FieldIdx, RetagPlan<V>>();
    field_plans.set(ix, self);
    return {
      $: "Recurse",
      field_plans: { $: "Arbitrary", _0: field_plans },
      variant_plans: new Map(),
    };
  },

  // ---- impl<'a, 'tcx, V> RetagPlan<V> ----

  /// Attempts to create a [`RetagPlan`] for a place or operand with the given layout.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:69 build
  build<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout, is_fn_entry: boolean): RetagPlan<B["Value"]> | undefined {
    // If the value being retagged is smaller than a pointer, then it can't contain any
    // pointers we need to retag, so we can stop recursion early. This optimization is
    // crucial for ZSTs, because they can contain way more fields than we can ever visit.
    if (layout.is_sized() && Size_cmp(layout.size, bx.tcx_().data_layout().pointer_size()) < 0) {
      return undefined;
    }
    // Check the type of this value to see what to do with it (retag, or recurse).
    const kind = layout.ty.kind();
    if (kind.$ === "Ref") {
      const pointee = kind._1;
      const mt = kind._2;
      const pointee_layout = bx.layout_of(pointee);
      return RetagPlan.emit_retag(bx, pointee_layout, mt, is_fn_entry);
    } else if (kind.$ === "RawPtr") {
      return undefined;
    } else if (kind.$ === "Adt" && kind._0.is_box()) {
      // `Box` needs special handling, since the innermost pointer is what gets retagged, but
      //  the outermost `Box` is what determines the permission that gets created.
      return RetagPlan.visit_box(bx, layout, is_fn_entry);
    } else if (layout.ty.is_like_maybe_dangling()) {
      // Skip traversing for everything inside of `MaybeDangling`
      return undefined;
    } else {
      return RetagPlan.walk_value(bx, layout, is_fn_entry);
    }
  },

  /// Recurses through the fields and variants of a value in memory order to create a [`RetagPlan`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:97 walk_value
  walk_value<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout, is_fn_entry: boolean): RetagPlan<B["Value"]> | undefined {
    let field_plans: RetagFields<B["Value"]> | undefined;
    const fields = layout.fields;
    switch (fields.$) {
      case "Union":
      case "Primitive":
        field_plans = undefined;
        break;
      case "Arbitrary": {
        const field_plans_ = new Map<FieldIdx, RetagPlan<B["Value"]>>();
        for (const ix of FieldsShape.index_by_increasing_offset(layout.fields)) {
          const field_layout = layout.field(bx, ix);
          const plan = RetagPlan.build(bx, field_layout, is_fn_entry);
          if (plan !== undefined) {
            field_plans_.set(FieldIdx.from_usize(ix), plan);
          }
        }
        field_plans = field_plans_.size !== 0 ? { $: "Arbitrary", _0: field_plans_ } : undefined;
        break;
      }
      case "Array": {
        if (fields.count > 0n) {
          const field_layout = layout.field(bx, 0);
          const plan = RetagPlan.build(bx, field_layout, is_fn_entry);
          field_plans = plan !== undefined ? { $: "Array", _0: plan } : undefined;
        } else {
          field_plans = undefined;
        }
        break;
      }
    }

    const variant_plans = new Map<VariantIdx, RetagPlan<B["Value"]>>();
    const variants = layout.variants;
    switch (variants.$) {
      case "Single":
      case "Empty":
        break;
      case "Multiple": {
        for (let i = 0; i < variants.variants.length; i++) {
          const ix = VariantIdx.from_usize(i);
          const variant_layout = layout.for_variant(bx, ix);
          const plan = RetagPlan.build(bx, variant_layout, is_fn_entry);
          if (plan !== undefined) {
            variant_plans.set(ix, plan);
          }
        }
        break;
      }
    }

    return field_plans !== undefined || variant_plans.size !== 0 ? { $: "Recurse", field_plans, variant_plans } : undefined;
  },

  /// Emits a retag for a `Box`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:140 visit_box
  visit_box<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout, is_fn_entry: boolean): RetagPlan<B["Value"]> | undefined {
    assert(layout.ty.is_box(), "assertion failed: layout.ty.is_box()");
    assert_eq_msg(FieldsShape.count(layout.fields), 2, "`Box` must have exactly 2 fields");
    const field_plans = new Map<FieldIdx, RetagPlan<B["Value"]>>();

    // Only retag the inner pointer of a `Box` if it came from the global allocator.
    if (layout.ty.is_box_global(bx.tcx_())) {
      const boxed_ty = layout.ty.expect_boxed_ty();
      const boxed_layout = bx.layout_of(boxed_ty);
      let plan = RetagPlan.emit_retag(bx, boxed_layout, undefined, is_fn_entry);
      if (plan !== undefined) {
        // `Unique<T>`
        const unique = layout.field(bx, 0);
        assert_eq(FieldsShape.count(unique.fields), 2, String);
        plan = RetagPlan.for_field(plan, FieldIdx.ZERO);

        // `NonNull<T>`
        const nonnull = unique.field(bx, 0);
        assert_eq(FieldsShape.count(nonnull.fields), 1, String);
        plan = RetagPlan.for_field(plan, FieldIdx.ZERO);

        // `*mut T is !null`
        const pattern = nonnull.field(bx, 0);
        const pk = pattern.ty.kind();
        if (pk.$ !== "Pat") {
          return unreachable("`NonNull` should contain a pattern type");
        }
        const base = pk._0;
        assert_eq<Ty | undefined>(base.builtin_deref(true), boxed_ty, (v) => debug_option(v, PLAIN, debug_Ty));

        field_plans.set(FieldIdx.ZERO, plan);
      }
    }

    // We always try to retag the second field (the allocator)
    const field_layout = layout.field(bx, 1);
    const plan = RetagPlan.build(bx, field_layout, is_fn_entry);
    if (plan !== undefined) {
      field_plans.set(FieldIdx.ONE, plan);
    }

    return field_plans.size !== 0
      ? {
          $: "Recurse",
          field_plans: { $: "Arbitrary", _0: field_plans },
          variant_plans: new Map(),
        }
      : undefined;
  },

  /// Determines if a pointer needs to be retagged, when it points to
  /// a type with the given layout. Returns `None` for mutable pointers
  /// to types that are entirely covered by `UnsafePinned`, for which retags
  /// are a no-op.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:191 emit_retag
  emit_retag<B extends BackendTypes>(
    bx: BuilderMethods<B>,
    pointee_layout: TyAndLayout,
    ptr_kind: Mutability | undefined,
    is_fn_entry: boolean,
  ): RetagPlan<B["Value"]> | undefined {
    const tcx = bx.tcx_();
    // PORT: `unwrap_or_default()`: `CodegenRetagOptions`'s derived `Default` is both flags `false`.
    const retag_opts = tcx.sess.opts.unstable_opts.codegen_emit_retag ?? { no_precise_im: false, no_precise_pin: false };

    const pointee_ty = pointee_layout.ty;

    const is_mutable = ptr_kind === "Mut" || ptr_kind === undefined;
    const is_unpin = UnsafePinnedRanges.excludes(bx, pointee_ty);
    const is_freeze = UnsafeCellRanges.excludes(bx, pointee_ty);
    const is_box = ptr_kind === undefined;

    // `&mut !Unpin` is not protected
    const is_protected = is_fn_entry && (!is_mutable || is_unpin);

    const pin_ranges = UnsafePinnedRanges.collect(bx, pointee_layout, retag_opts.no_precise_pin);

    if (is_mutable) {
      // Everything is `UnsafePinned` if the collected ranges
      // cover the entire size of the layout.
      const all_pinned = pin_ranges.length === 1 && Size_eq(pin_ranges[0]![0], Size.ZERO) && Size_eq(pin_ranges[0]![1], pointee_layout.size);

      // Otherwise, if we can't find any `UnsafePinned`,
      // the type is still might be `!Unpin` or `!UnsafeUnpin`,
      // so we should include the entire range.
      const implicitly_pinned = pin_ranges.length === 0 && !is_unpin;

      if (all_pinned || implicitly_pinned) {
        return undefined;
      }
    }

    if (is_mutable && !is_unpin) {
      return undefined;
    }

    const im_ranges = UnsafeCellRanges.collect(bx, pointee_layout, retag_opts.no_precise_im);
    const all_im = im_ranges.length === 1 && Size_eq(im_ranges[0]![0], Size.ZERO) && Size_eq(im_ranges[0]![1], pointee_layout.size);

    const pin_layout = RetagPlan.alloc_ranges(bx, pin_ranges);

    // If the entire type is covered by `UnsafeCell`, then we can
    // defer to checking if the type is `Freeze` via `RetagFlags`,
    // to avoid allocating a global array.
    const im_layout = all_im ? bx.const_null(bx.type_ptr()) : RetagPlan.alloc_ranges(bx, im_ranges);

    let flags: RetagFlags = 0;
    flags = RetagFlags_set(flags, RetagFlags.IS_PROTECTED, is_protected);
    flags = RetagFlags_set(flags, RetagFlags.IS_MUTABLE, is_mutable);
    // Even though we have a list of interior mutable ranges,
    // we still need a separate flag for `Freeze` types, for when
    // we retag interior mutable ZSTs.
    flags = RetagFlags_set(flags, RetagFlags.IS_FREEZE, is_freeze);
    flags = RetagFlags_set(flags, RetagFlags.IS_BOX, is_box);

    return {
      $: "EmitRetag",
      _0: {
        size: pointee_layout.size,
        im_layout,
        pin_layout,
        flags,
      },
    };
  },

  /// Creates a pointer to a global static allocation containing adjacent pairs of `u64` bytes,
  /// which indicate the offset and width of a range within the layout of a type. Returns a null
  /// pointer if the list of ranges is empty.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:268 alloc_ranges
  alloc_ranges<B extends BackendTypes>(bx: BuilderMethods<B>, ranges: [Size, Size][]): B["Value"] {
    const tcx = bx.tcx_();
    const data_layout = tcx.data_layout();

    if (ranges.length === 0) {
      return bx.const_null(bx.type_ptr());
    }

    // PORT: `u64::to_ne_bytes` is the byte order of the machine running the compiler; a `BigUint64Array` stores in the
    // JS engine's native order, which is that machine's.
    const words = new BigUint64Array(ranges.length * 2);
    let w = 0;
    for (const [start, end] of ranges) {
      words[w++] = start.bytes_u64();
      words[w++] = end.bytes_u64();
    }
    const bytes = new Uint8Array(words.buffer);

    const intptr_ty = data_layout.ptr_sized_integer();
    const align = Integer.align(intptr_ty, data_layout).abi;

    const alloc = Allocation.from_bytes(bytes, align, "Not", null);
    const const_alloc = tcx.mk_const_alloc(alloc);

    // Different IDs are produced, but identical range lists
    // will resolve to the same allocation.
    const alloc_id = tcx.reserve_and_set_memory_alloc(const_alloc);
    const global_alloc = tcx.global_alloc(alloc_id);
    const global_mem = GlobalAlloc.unwrap_memory(global_alloc);

    return bx.cx().static_addr_of(global_mem, undefined);
  },
};

/** `RetagFlags::set` (bitflags): insert `flag` if `value`, else remove it. */
function RetagFlags_set(flags: RetagFlags, flag: RetagFlags, value: boolean): RetagFlags {
  return value ? flags | flag : flags & ~flag;
}

/** `assert_eq!(left, right, "msg")` of two `usize`s (core's text: the message after the `failed: `). */
function assert_eq_msg(left: number, right: number, msg: string): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed: ${msg}\n  left: ${left}\n right: ${right}`);
  }
}

/// A visitor trait for collecting the ranges within a layout that satisfy a given predicate.
interface PerByteTracking {
  /// Indicates that we can exclude the range of bytes that contains this type.
  /// This tells us that [`PerByteTracking::contains`] is false for every
  /// field or variant without having to recurse any further into the layout of the type.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:306 excludes
  excludes<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean;

  /// Indicates that we should include the range containing this type.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:309 contains
  contains<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean;

  // (provided) retag.rs:316 visit_layout -> PerByteTracking_provided.visit_layout
  // (provided) retag.rs:356 collect -> PerByteTracking_provided.collect
}

const PerByteTracking_provided = {
  /// Traverses through the layout of a type to find each range satisfying
  /// the predicate.
  ///
  /// If `imprecise` is true, then the entire size of the type will be included,
  /// even if only one of its fields satisfies the predicate.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:316 visit_layout
  visit_layout<B extends BackendTypes>(
    Self_: PerByteTracking,
    bx: BuilderMethods<B>,
    offset: Size,
    ranges: RangeSet<Size>,
    layout: TyAndLayout,
    imprecise: boolean,
  ): void {
    if (layout.is_zst()) {
      return;
    }

    if (Self_.excludes(bx, layout.ty)) {
      return;
    }

    if (imprecise) {
      return ranges.add_range(offset, layout.size);
    }

    const union_or_primitive = layout.fields.$ === "Union" || layout.fields.$ === "Primitive";
    const has_multiple_variants = layout.variants.$ === "Multiple";

    if (Self_.contains(bx, layout.ty) || union_or_primitive || has_multiple_variants) {
      ranges.add_range(offset, layout.size);
    } else {
      // We know at this point that we have an array or an arbitrary layout.
      for (const ix of FieldsShape.index_by_increasing_offset(layout.fields)) {
        // We need to find the offset for this field relative
        // to the entire type, not just the current aggregate
        // that we are visiting here.
        const field_offset = FieldsShape.offset(layout.fields, ix);
        const layout_offset = field_offset.add(offset);

        const field = layout.field(bx, ix);
        PerByteTracking_provided.visit_layout(Self_, bx, layout_offset, ranges, field, imprecise);
      }
    }
  },
  /// Collects the ranges within a type that satisfy the given predicate.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:356 collect
  collect<B extends BackendTypes>(Self_: PerByteTracking, bx: BuilderMethods<B>, layout: TyAndLayout, imprecise: boolean): [Size, Size][] {
    const ranges = RangeSet.new<Size>(SIZE_RANGE_SET_OPS);
    PerByteTracking_provided.visit_layout(Self_, bx, Size.ZERO, ranges, layout, imprecise);
    return ranges._0;
  },
};

/// Collects the ranges within a type that are covered by `UnsafeCell`.
// struct UnsafeCellRanges;
const UnsafeCellRanges = {
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:367 excludes
  excludes<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean {
    return ty.is_freeze(bx.tcx_(), bx.cx().typing_env_());
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:371 contains
  contains<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean {
    const tcx = bx.tcx_();
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const lang = tcx.lang_items().unsafe_cell_type();
        return lang !== undefined && DefId_eq(k._0.did(), lang);
      }
      default:
        return false;
    }
  },

  collect<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout, imprecise: boolean): [Size, Size][] {
    return PerByteTracking_provided.collect(UnsafeCellRanges, bx, layout, imprecise);
  },
} satisfies PerByteTracking & Record<string, unknown>;

/// Collects the ranges within a type that are covered by `UnsafePinned`.
// struct UnsafePinnedRanges;
const UnsafePinnedRanges = {
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:384 excludes
  excludes<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean {
    return ty.is_unpin(bx.tcx_(), bx.typing_env_()) && ty.is_unsafe_unpin(bx.tcx_(), bx.typing_env_());
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:388 contains
  contains<B extends BackendTypes>(bx: BuilderMethods<B>, ty: Ty): boolean {
    const tcx = bx.tcx_();
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const lang = tcx.lang_items().unsafe_pinned_type();
        return lang !== undefined && DefId_eq(k._0.did(), lang);
      }
      default:
        return false;
    }
  },

  collect<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout, imprecise: boolean): [Size, Size][] {
    return PerByteTracking_provided.collect(UnsafePinnedRanges, bx, layout, imprecise);
  },
} satisfies PerByteTracking & Record<string, unknown>;

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_retag_operand(bx: Bx, operand: OperandRef<B["Value"]>, is_fn_entry: boolean): OperandRef<B["Value"]>;
    codegen_retag_place(bx: Bx, place_ref: PlaceRef<B["Value"]>, is_fn_entry: boolean): void;
    retag_operand(
      bx: Bx,
      plan: RetagPlan<B["Value"]>,
      curr_operand: OperandRef<B["Value"]>,
      builder: OperandRefBuilder<B["Value"]>,
      offset: Size,
    ): void;
    retag_place(bx: Bx, plan: RetagPlan<B["Value"]>, place: PlaceRef<B["Value"]>): void;
    retag_variants(bx: Bx, place: PlaceRef<B["Value"]>, discr: B["Value"], variant_plans: Map<VariantIdx, RetagPlan<B["Value"]>>): void;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of retag.rs (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; constant.ts header).
export function install_FunctionCx_retag(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  /// Retags the pointers within an [`OperandRef`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:399 codegen_retag_operand
  FunctionCx_.prototype.codegen_retag_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    operand: OperandRef<unknown>,
    is_fn_entry: boolean,
  ): OperandRef<unknown> {
    if (operand.val.$ === "Ref") {
      const place_ref = operand.val._0.with_type(operand.layout, bx.debug_Value);
      this.codegen_retag_place(bx, place_ref, is_fn_entry);
    } else {
      const plan = RetagPlan.build(bx, operand.layout, is_fn_entry);
      if (plan !== undefined) {
        const builder = OperandRefBuilder.from_existing(operand, bx.debug_Value);
        this.retag_operand(bx, plan, operand, builder, Size.ZERO);
        return builder.build(bx.cx());
      }
    }
    return operand;
  };

  /// Retags the pointers within a [`PlaceRef`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:417 codegen_retag_place
  FunctionCx_.prototype.codegen_retag_place = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place_ref: PlaceRef<unknown>,
    is_fn_entry: boolean,
  ): void {
    const plan = RetagPlan.build(bx, place_ref.layout, is_fn_entry);
    if (plan !== undefined) {
      this.retag_place(bx, plan, place_ref);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:428 retag_operand
  FunctionCx_.prototype.retag_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    plan: RetagPlan<unknown>,
    curr_operand: OperandRef<unknown>,
    builder: OperandRefBuilder<unknown>,
    offset: Size,
  ): void {
    switch (plan.$) {
      case "EmitRetag": {
        const info = plan._0;
        const [pointer] = OperandValue.pointer_parts(curr_operand.val, bx.debug_Value);
        const retagged_pointer = bx.retag_reg(pointer, info);
        builder.update_imm(offset, retagged_pointer, bx.debug_Value);
        break;
      }
      case "Recurse": {
        const { field_plans, variant_plans } = plan;
        const layout = curr_operand.layout;
        if (field_plans !== undefined) {
          const plans = field_plans;
          const retag_field = (ix: FieldIdx, plan: RetagPlan<unknown>): void => {
            const inner_offset = FieldsShape.offset(layout.fields, FieldIdx.as_usize(ix));
            const field_offset = offset.add(inner_offset);
            const field_layout = curr_operand.layout.field(bx, FieldIdx.index(ix));
            if (curr_operand.layout.is_ssa_standalone() && !field_layout.is_ssa_standalone()) {
              // FIXME: Nothing should be looking at the *array* inside a `repr(simd)` type,
              // as that array doesn't really exist. Perhaps this should be a `bug!`,
              // with simd types handled before getting here?
            } else {
              const field_operand = curr_operand.extract_field(this, bx, FieldIdx.as_usize(ix));
              this.retag_operand(bx, plan, field_operand, builder, field_offset);
            }
          };

          switch (plans.$) {
            case "Arbitrary": {
              const field_plans = plans._0;
              for (const [ix, plan] of field_plans) {
                retag_field(ix, plan);
              }
              break;
            }
            case "Array": {
              const plan = plans._0;
              const fields = layout.fields;
              if (fields.$ !== "Array") {
                return bug(`Expected \`FieldsShape::Array\` but found ${format_debug(layout.fields, debug_FieldsShape, PLAIN)}`);
              }
              const count = fields.count;
              // PORT: `0..count` over the `u64`; `FieldIdx::from_usize` stops (asserts) far below 2^53.
              for (let idx_ = 0n; idx_ < count; idx_++) {
                const idx = FieldIdx.from_usize(Number(idx_));
                retag_field(idx, plan);
              }
              break;
            }
          }
        }

        if (variant_plans.size !== 0) {
          const discr_ty = layout.ty.discriminant_ty(bx.tcx_());
          const discr_val = curr_operand.codegen_get_discr(this, bx, discr_ty);

          const val = bx.const_to_opt_u128(discr_val, false);
          if (val !== undefined) {
            // PORT: `val as usize` truncates the `u128` to 64 bits.
            const ix = VariantIdx.from_usize(Number(BigInt.asUintN(64, val)));
            const plan = variant_plans.get(ix);
            if (plan !== undefined) {
              // PORT: `let mut variant_op = curr_operand; variant_op.layout = ..` builds a new `OperandRef` (header).
              const variant_op = new OperandRefC(curr_operand.val, curr_operand.layout.for_variant(bx, ix), curr_operand.move_annotation);

              this.retag_operand(bx, plan, variant_op, builder, offset);
            }
          } else {
            // We create a temporary place to store the operand, because its
            // value will differ depending on the variant that we have.
            const scratch = PlaceRef.alloca(bx, curr_operand.layout);
            scratch.storage_live(bx);
            curr_operand.store_with_annotation(bx, scratch);

            // We retag the contents of the place
            this.retag_variants(bx, scratch, discr_val, variant_plans);

            // Afterward, we load the now-updated operand and end the lifetime of the place.
            const updated_op = bx.load_operand(scratch);
            scratch.storage_dead(bx);

            const v = updated_op.val;
            switch (v.$) {
              case "ZeroSized":
              case "Ref":
                break;
              case "Immediate":
                builder.update_imm(offset, v._0, bx.debug_Value);
                break;
              case "Pair": {
                const fst = v._0;
                const snd = v._1;
                builder.update_imm(offset, fst, bx.debug_Value);
                builder.update_imm(offset.add(Size.from_bytes(1)), snd, bx.debug_Value);
                break;
              }
            }
          }
        }
        break;
      }
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:519 retag_place
  FunctionCx_.prototype.retag_place = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    plan: RetagPlan<unknown>,
    place: PlaceRef<unknown>,
  ): void {
    switch (plan.$) {
      case "EmitRetag": {
        const info = plan._0;
        bx.retag_mem(place.val.llval, info);
        break;
      }
      case "Recurse": {
        const { field_plans, variant_plans } = plan;
        if (field_plans !== undefined) {
          const retag_field = (ix: FieldIdx, plan: RetagPlan<unknown>): void => {
            const field_place = place.project_field(bx, FieldIdx.as_usize(ix));
            this.retag_place(bx, plan, field_place);
          };
          switch (field_plans.$) {
            case "Arbitrary": {
              const fields = field_plans._0;
              for (const [ix, plan] of fields) {
                retag_field(ix, plan);
              }
              break;
            }
            case "Array": {
              const plan = field_plans._0;
              const fields = place.layout.fields;
              if (fields.$ !== "Array") {
                return bug(`Expected \`FieldsShape::Array\` but found ${format_debug(place.layout.fields, debug_FieldsShape, PLAIN)}`);
              }
              const count = fields.count;
              // When an array of N references needs to be retagged (e.g. `[&T; N]`),
              // it is more efficient to emit a loop for large values of N than
              // to emit N retags in succession.
              within_loop(bx, count, (bx: BuilderMethods<BackendTypes>, ix: unknown) => {
                const field_place = place.project_index(bx, ix);
                this.retag_place(bx, plan, field_place);
              });
              break;
            }
          }
        }
        if (variant_plans.size !== 0) {
          const operand = bx.load_operand(place);
          const discr_ty = place.layout.ty.discriminant_ty(bx.tcx_());
          const discr_val = operand.codegen_get_discr(this, bx, discr_ty);
          this.retag_variants(bx, place, discr_val, variant_plans);
        }
        break;
      }
    }
  };

  /// Retags each variant of a [`PlaceRef`] with the given discriminant.
  // rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:569 retag_variants
  FunctionCx_.prototype.retag_variants = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place: PlaceRef<unknown>,
    discr: unknown,
    variant_plans: Map<VariantIdx, RetagPlan<unknown>>,
  ): void {
    const layout = place.layout;

    const root_block = bx.llbb();
    const variant_blocks: [bigint, unknown][] = [];
    const join_block = bx.append_sibling_block("retag_join");

    for (const [ix, plan] of variant_plans) {
      const variant_discr = layout.ty.discriminant_for_variant(bx.tcx_(), ix);
      if (variant_discr === undefined) {
        panic("Invalid variant index.");
      }
      const variant_discr_val = variant_discr.val;

      const variant_block = bx.append_sibling_block("retag_variant");
      bx.switch_to_block(variant_block);

      const variant_place = place.project_downcast(bx, ix);
      this.retag_place(bx, plan, variant_place);

      variant_blocks.push([variant_discr_val, variant_block]);
      bx.br(join_block);
    }

    bx.switch_to_block(root_block);
    bx.switch(discr, join_block, variant_blocks);
    bx.switch_to_block(join_block);
  };
}

/// Creates a simple loop, iterating the specified number of times.
/// The dynamic value of the loop counter is passed as an argument
/// to the closure.
// rustc: compiler/rustc_codegen_ssa/src/mir/retag.rs:605 within_loop
function within_loop<B extends BackendTypes>(bx: BuilderMethods<B>, max_iter: bigint, op: (bx: BuilderMethods<B>, ix: B["Value"]) => void): void {
  // Avoid emitting a no-op loop
  if (max_iter === 0n) {
    return;
  }

  // Initialize the loop counter to zero.
  const counter_layout = bx.layout_of(bx.tcx_().types.usize);
  const counter_alloca = PlaceRef.alloca(bx, counter_layout);
  counter_alloca.storage_live(bx);
  bx.store_to_place(bx.const_usize(0n), counter_alloca.val);

  // Jump to a new block for the body of the loop.
  const loop_body = bx.append_sibling_block("retag_loop");
  bx.br(loop_body);

  bx.switch_to_block(loop_body);

  // Load the value of the counter, and pass it to the closure.
  const curr_count = bx.load_from_place(bx.type_isize(), counter_alloca.val);
  op(bx, curr_count);

  const next_count = bx.unchecked_uadd(curr_count, bx.const_usize(1n));
  bx.store_to_place(next_count, counter_alloca.val);

  // If the next count is equal to the maximum number of
  // iterations, then exit the loop.
  const max_count = bx.const_usize(max_iter);
  const loop_exit = bx.append_sibling_block("retag_loop_exit");
  const should_exit_loop = bx.icmp(IntPredicate.IntEQ, next_count, max_count);
  bx.cond_br(should_exit_loop, loop_exit, loop_body);

  bx.switch_to_block(loop_exit);
  counter_alloca.storage_dead(bx);
}
