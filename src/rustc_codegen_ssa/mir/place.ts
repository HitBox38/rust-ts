// Port of compiler/rustc_codegen_ssa/src/mir/place.rs (lane ssa-operand-place, plan-m7 wave 41).
//
// PORT (ssa-operand-place):
// - Copy semantics (docs/reviews/ssa-contract.md N5): `PlaceValue` and `PlaceRef` are upstream `Copy`, so their
//   fields are `readonly`. Where upstream copies one into a `mut` local and writes a field (`project_downcast`,
//   `project_type`, `unaligned`, `codegen_place`'s `Subslice` arm), the port builds a new object with the changed
//   field instead. A shared object is therefore never written, and identity carries no meaning.
// - Generic code over `Bx: BuilderMethods<Value = V>` takes `bx: BuilderMethods<B>` with `V = B["Value"]` (the
//   ssa-contract representation); methods that need it declare `this: PlaceRef<B["Value"]>`.
// - `{:?}` of a backend value (`V: CodegenObject`) needs the backend's `Debug` impl, which a method without a `bx`/`cx`
//   does not have (`PlaceValue::with_type`). Such methods take an optional trailing `debug_V`; callers that have a
//   builder pass `bx.debug_Value`. Only an assertion that already failed formats it; without a `debug_V` that path
//   stops with `unported` (exit 70) instead of printing a guessed rendering.
// - The `impl FunctionCx` block (`codegen_place`, `monomorphized_place_ty`) is in `install_FunctionCx_place`, which
//   mod.ts calls right after `class FunctionCx`: mod.ts needs this module at run time (`PlaceRef.alloca`, ...), so a
//   top-level `FunctionCx.prototype` write here would hit the class's TDZ whenever mod.ts loads first. This module
//   imports mod.ts for types only.
// - Calls into lanes not yet ported are typed module-private stubs (`unported("<lane>: <path> <fn>")`):
//   `size_of_val::size_and_align_of_dst` (size_of_val.rs; plan-m7's MIR core group, no lane yet).
import { Align, debug_Align, FieldsShape, type FieldIdx, type Size, type VariantIdx } from "../../rustc_abi/lib.ts";
import { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import type { PlaceRef as mir_PlaceRef } from "../../rustc_middle/mir/statement.ts";
import { debug_PlaceRef as debug_mir_PlaceRef, PlaceTy } from "../../rustc_middle/mir/statement.ts";
import { PlaceRef as mir_PlaceRefC } from "../../rustc_middle/mir/statement.gen.ts";
import { debug_Local, Place_from_Local } from "../../rustc_middle/mir/mod.ts";
import { debug_TyAndLayout_Ty, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Debug, debug_option, debug_struct, format_debug, type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { IntPredicate } from "../common.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { ConstCodegenMethods } from "../traits/consts.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";
import { OperandValue } from "./operand.ts";

/** Stub: `rustc_codegen_ssa::size_of_val::size_and_align_of_dst` (size_of_val.rs; no lane yet). */
function size_and_align_of_dst<B extends BackendTypes>(
  _bx: BuilderMethods<B>,
  _t: Ty,
  _info: B["Value"] | undefined,
  _span: Span,
): [B["Value"], B["Value"]] {
  return unported("compiler/rustc_codegen_ssa/src/size_of_val.rs size_and_align_of_dst (plan-m7 MIR core group, no lane yet)");
}

/** The `Debug` of a backend value, or a stop where the caller had none to give (header). */
export function debug_V_or_stop<V>(debug_V: Debug<V> | undefined): Debug<V> {
  return debug_V ?? (() => unported("ssa-operand-place: `{:?}` of a backend value without the backend's Debug impl"));
}

/// The location and extra runtime properties of the place.
///
/// Typically found in a [`PlaceRef`] or an [`OperandValue::Ref`].
///
/// As a location in memory, this has no specific type. If you want to
/// load or store it using a typed operation, use [`Self::with_type`].
// #[derive(Copy, Clone, Debug)]
export class PlaceValue<V> {
  constructor(
    /// A pointer to the contents of the place.
    readonly llval: V,

    /// This place's extra data if it is unsized, or `None` if null.
    readonly llextra: V | undefined,

    /// The alignment we know for this place.
    readonly align: Align,
  ) {}

  /// Constructor for the ordinary case of `Sized` types.
  ///
  /// Sets `llextra` to `None`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:42 new_sized
  static new_sized<V>(llval: V, align: Align): PlaceValue<V> {
    return new PlaceValue(llval, undefined, align);
  }

  /// Allocates a stack slot in the function for a value
  /// of the specified size and alignment.
  ///
  /// The allocation itself is untyped.
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:50 alloca
  static alloca<B extends BackendTypes>(bx: BuilderMethods<B>, size: Size, align: Align): PlaceValue<B["Value"]> {
    const llval = bx.alloca(size, align);
    return PlaceValue.new_sized(llval, align);
  }

  /// Creates a `PlaceRef` to this location with the given type.
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:60 with_type
  with_type(layout: TyAndLayout, debug_V?: Debug<V>): PlaceRef<V> {
    assert(
      layout.is_unsized() || layout.is_uninhabited() || this.llextra === undefined,
      () =>
        `Had pointer metadata ${debug_option(this.llextra, PLAIN, debug_V_or_stop(debug_V))} for sized type ${format_debug(layout, debug_TyAndLayout_Ty, PLAIN)}`,
    );
    return new PlaceRef(this, layout);
  }

  /// Gets the pointer to this place as an [`OperandValue::Immediate`]
  /// or, for those needing metadata, an [`OperandValue::Pair`].
  ///
  /// This is the inverse of [`OperandValue::deref`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:73 address
  address(): OperandValue<V> {
    const llextra = this.llextra;
    if (llextra !== undefined) {
      return { $: "Pair", _0: this.llval, _1: llextra };
    } else {
      return { $: "Immediate", _0: this.llval };
    }
  }
}
// derive(Debug)
export function debug_PlaceValue<V>(v: PlaceValue<V>, f: Fmt, debug_V: Debug<V>): string {
  return debug_struct(f, "PlaceValue", [
    ["llval", debug_V(v.llval, f)],
    ["llextra", debug_option(v.llextra, f, debug_V)],
    ["align", debug_Align(v.align, f)],
  ]);
}

// #[derive(Copy, Clone, Debug)]
export class PlaceRef<V> {
  constructor(
    /// The location and extra runtime properties of the place.
    readonly val: PlaceValue<V>,

    /// The monomorphized type of this place, including variant information.
    ///
    /// You probably shouldn't use the alignment from this layout;
    /// rather you should use the `.val.align` of the actual place,
    /// which might be different from the type's normal alignment.
    readonly layout: TyAndLayout,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:96 new_sized
  static new_sized<V>(llval: V, layout: TyAndLayout): PlaceRef<V> {
    return PlaceRef.new_sized_aligned(llval, layout, layout.align.abi);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:100 new_sized_aligned
  static new_sized_aligned<V>(llval: V, layout: TyAndLayout, align: Align): PlaceRef<V> {
    assert(layout.is_sized(), "assertion failed: layout.is_sized()");
    return PlaceValue.new_sized(llval, align).with_type(layout);
  }

  // FIXME(eddyb) pass something else for the name so no work is done
  // unless LLVM IR names are turned on (e.g. for `--emit=llvm-ir`).
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:111 alloca
  static alloca<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout): PlaceRef<B["Value"]> {
    // FIXME(rustc_scalable_vector/stdarch_aarch64_sve): Scalable vectors aren't actually sized,
    // but we pretend they are. Here we have to hack around that.
    if (layout.peel_transparent_wrappers_from_non_1zst(bx).deref().is_scalable_vector()) {
      return PlaceRef.alloca_scalable(bx, layout);
    } else {
      return PlaceRef.alloca_size(bx, layout.size, layout);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:124 alloca_size
  static alloca_size<B extends BackendTypes>(bx: BuilderMethods<B>, size: Size, layout: TyAndLayout): PlaceRef<B["Value"]> {
    assert(layout.is_sized(), "tried to statically allocate unsized place");
    return PlaceValue.alloca(bx, size, layout.align.abi).with_type(layout, bx.debug_Value);
  }

  /// Returns a place for an indirect reference to an unsized place.
  // FIXME(eddyb) pass something else for the name so no work is done
  // unless LLVM IR names are turned on (e.g. for `--emit=llvm-ir`).
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:136 alloca_unsized_indirect
  static alloca_unsized_indirect<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout): PlaceRef<B["Value"]> {
    assert(layout.is_unsized(), "tried to allocate indirect place for sized values");
    const ptr_ty = Ty.new_mut_ptr(bx.cx().tcx_(), layout.ty);
    const ptr_layout = bx.cx().layout_of(ptr_ty);
    return PlaceRef.alloca(bx, ptr_layout);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:146 len
  len<B extends BackendTypes>(this: PlaceRef<B["Value"]>, cx: ConstCodegenMethods<B>): B["Value"] {
    const fields = this.layout.fields;
    if (fields.$ === "Array") {
      const count = fields.count;
      if (this.layout.is_unsized()) {
        assert_eq(count, 0n, String);
        return unwrap(this.val.llextra);
      } else {
        return cx.const_usize(count);
      }
    } else {
      return bug(`unexpected layout \`${format_debug(this.layout, debug_TyAndLayout_Ty, PRETTY)}\` in PlaceRef::len`);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:159 alloca_scalable
  private static alloca_scalable<B extends BackendTypes>(bx: BuilderMethods<B>, layout: TyAndLayout): PlaceRef<B["Value"]> {
    return PlaceValue.new_sized(
      // FIXME why is this peeling at all? The LLVM type should be the same for the
      // transparent wrapper and the inner type.
      bx.alloca_with_ty(layout.peel_transparent_wrappers_from_non_1zst(bx)),
      layout.align.abi,
    ).with_type(layout, bx.debug_Value);
  }

  /// Access a field, at a point when the value's case is known.
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:175 project_field
  project_field<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, ix: number): PlaceRef<B["Value"]> {
    const field = this.layout.field(bx.cx(), ix);
    const offset = FieldsShape.offset(this.layout.fields, ix);
    const effective_field_align = this.val.align.restrict_for_offset(offset);

    // `simple` is called when we don't need to adjust the offset to
    // the dynamic alignment of the field.
    const simple = (): PlaceRef<B["Value"]> => {
      const llval = offset.bytes() === 0 ? this.val.llval : bx.inbounds_ptradd(this.val.llval, bx.const_usize(offset.bytes_u64()));
      const val = new PlaceValue(
        llval,
        bx.cx().tcx_().type_has_metadata(field.ty, bx.cx().typing_env_()) ? this.val.llextra : undefined,
        effective_field_align,
      );
      return val.with_type(field, bx.debug_Value);
    };

    // Simple cases, which don't need DST adjustment:
    //   * known alignment - sized types, `[T]`, `str`
    //   * offset 0 -- rounding up to alignment cannot change the offset
    // Note that looking at `field.align` is incorrect since that is not necessarily equal
    // to the dynamic alignment of the type.
    const field_kind = field.ty.kind();
    if (field.is_sized()) {
      return simple();
    } else if (field_kind.$ === "Slice" || field_kind.$ === "Str") {
      return simple();
    } else if (offset.bytes() === 0) {
      return simple();
    } else {
      // _ => {}
    }

    // We need to get the pointer manually now.
    // We do this by casting to a `*i8`, then offsetting it by the appropriate amount.
    // We do this instead of, say, simply adjusting the pointer from the result of a GEP
    // because the field may have an arbitrary alignment in the LLVM representation.
    //
    // To demonstrate:
    //
    //     struct Foo<T: ?Sized> {
    //         x: u16,
    //         y: T
    //     }
    //
    // The type `Foo<Foo<Trait>>` is represented in LLVM as `{ u16, { u16, u8 }}`, meaning that
    // the `y` field has 16-bit alignment.

    const meta = this.val.llextra;

    const unaligned_offset = bx.cx().const_usize(offset.bytes_u64());

    // Get the alignment of the field. No span is available here to blame a layout error on.
    let [, unsized_align] = size_and_align_of_dst(bx, field.ty, meta, DUMMY_SP);

    // For packed types, we need to cap alignment.
    const self_kind = this.layout.ty.kind();
    let packed_: Align | undefined;
    if (self_kind.$ === "Adt" && (packed_ = self_kind._0.repr().pack) !== undefined) {
      const packed = bx.const_usize(BigInt(packed_.bytes()));
      const cmp = bx.icmp(IntPredicate.IntULT, unsized_align, packed);
      unsized_align = bx.select(cmp, unsized_align, packed);
    }

    // Bump the unaligned offset up to the appropriate alignment
    const offset_v = round_up_const_value_to_alignment(bx, unaligned_offset, unsized_align);

    // debug!("struct_field_ptr: DST field offset: {:?}", offset);

    // Adjust pointer.
    const ptr = bx.inbounds_ptradd(this.val.llval, offset_v);
    const val = new PlaceValue(ptr, this.val.llextra, effective_field_align);
    return val.with_type(field, bx.debug_Value);
  }

  /// Sets the discriminant for a new value of the given case of the given
  /// representation.
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:262 codegen_set_discr
  codegen_set_discr<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, variant_index: VariantIdx): void {
    const r = codegen_tag_value(bx.cx(), variant_index, this.layout);
    if (r.$ === "Err") {
      // We play it safe by using a well-defined `abort`, but we could go for immediate UB
      // if that turns out to be helpful.
      bx.abort_immediate();
    } else if (r._0 !== undefined) {
      const [tag_field, imm] = r._0;
      const tag_place = this.project_field(bx, tag_field);
      OperandValue.store({ $: "Immediate", _0: imm }, bx, tag_place);
    } else {
      // Ok(None) => {}
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:281 project_index
  project_index<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, llindex: B["Value"]): PlaceRef<B["Value"]> {
    // Statically compute the offset if we can, otherwise just use the element size,
    // as this will yield the lowest alignment.
    const layout = this.layout.field(bx, 0);
    const llindex_c = bx.const_to_opt_uint(llindex);
    const offset = llindex_c !== undefined ? (layout.size.checked_mul(llindex_c, bx) ?? layout.size) : layout.size;

    const llval = bx.inbounds_nuw_gep(bx.cx().backend_type(layout), this.val.llval, [llindex]);
    const align = this.val.align.restrict_for_offset(offset);
    return PlaceValue.new_sized(llval, align).with_type(layout, bx.debug_Value);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:300 project_downcast
  project_downcast<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, variant_index: VariantIdx): PlaceRef<B["Value"]> {
    // PORT: `let mut downcast = *self; downcast.layout = ..` builds the copy with the new layout (header).
    const downcast = new PlaceRef(this.val, this.layout.for_variant(bx.cx(), variant_index));
    return downcast;
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:310 project_type
  project_type<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, ty: Ty): PlaceRef<B["Value"]> {
    // PORT: `let mut downcast = *self; downcast.layout = ..` builds the copy with the new layout (header).
    const downcast = new PlaceRef(this.val, bx.cx().layout_of(ty));
    return downcast;
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:320 storage_live
  storage_live<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>): void {
    bx.lifetime_start(this.val.llval, this.layout.size);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:324 storage_dead
  storage_dead<B extends BackendTypes>(this: PlaceRef<B["Value"]>, bx: BuilderMethods<B>): void {
    bx.lifetime_end(this.val.llval, this.layout.size);
  }

  /// The same place, but with [`PlaceValue::align`] lowered to [`Align::ONE`].
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:329 unaligned
  unaligned(): PlaceRef<V> {
    const { val: val0, layout } = this;
    const val = new PlaceValue(val0.llval, val0.llextra, Align.ONE);
    return new PlaceRef(val, layout);
  }
}
// derive(Debug)
export function debug_PlaceRef<V>(v: PlaceRef<V>, f: Fmt, debug_V: Debug<V>): string {
  return debug_struct(f, "PlaceRef", [
    ["val", debug_PlaceValue(v.val, f, debug_V)],
    ["layout", debug_TyAndLayout_Ty(v.layout, f)],
  ]);
}

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_place(bx: Bx, place_ref: mir_PlaceRef): PlaceRef<B["Value"]>;
    monomorphized_place_ty(place_ref: mir_PlaceRef): Ty;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of place.rs; mod.ts calls this once, right
 *  after its `class FunctionCx` (header). */
export function install_FunctionCx_place(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // #[instrument(level = "trace", skip(self, bx))]
  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:338 codegen_place
  FunctionCx_.prototype.codegen_place = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place_ref: mir_PlaceRef,
  ): PlaceRef<unknown> {
    const cx = this.cx;
    const tcx = this.cx.tcx_();

    let base = 0;
    let cg_base: PlaceRef<unknown>;
    const local_ref = this.locals.index(place_ref.local);
    switch (local_ref.$) {
      case "Place":
        cg_base = local_ref._0;
        break;
      case "UnsizedPlace":
        cg_base = bx.load_operand(local_ref._0).deref(cx);
        break;
      case "Operand":
        if (place_ref.is_indirect_first_projection()) {
          base = 1;
          const cg_base_ = this.codegen_consume(bx, new mir_PlaceRefC(place_ref.local, place_ref.projection.slice(0, 0)));
          cg_base = cg_base_.deref(bx.cx());
        } else {
          return bug(`using operand local ${debug_mir_PlaceRef(place_ref, PLAIN)} as place`);
        }
        break;
      case "PendingOperand":
        return bug(`using still-pending operand local ${debug_mir_PlaceRef(place_ref, PLAIN)} as place`);
    }
    for (const elem of place_ref.projection.slice(base)) {
      switch (elem.$) {
        case "Deref":
          cg_base = bx.load_operand(cg_base).deref(bx.cx());
          break;
        case "PhantomDeref":
          return bug("encountered PhantomDeref in codegen");
        case "Field": {
          const field = elem._0;
          const cg_base_ = cg_base;
          assert(
            !cg_base.layout.ty.is_any_ptr(),
            () =>
              `Bad PlaceRef: destructing pointers should use cast/PtrMetadata, but tried to access field ${String(field)} of pointer ${debug_PlaceRef(cg_base_, PLAIN, bx.debug_Value)}`,
          );
          cg_base = cg_base.project_field(bx, field);
          break;
        }
        case "OpaqueCast":
          return bug(`encountered OpaqueCast(${display_Ty(elem._0)}) in codegen`);
        case "UnwrapUnsafeBinder":
          cg_base = cg_base.project_type(bx, this.monomorphize(elem._0, fold_Ty));
          break;
        case "Index": {
          const index_ = { $: "Copy" as const, _0: Place_from_Local(elem._0) };
          const index = this.codegen_operand(bx, index_);
          const llindex = index.immediate(bx.debug_Value);
          cg_base = cg_base.project_index(bx, llindex);
          break;
        }
        case "ConstantIndex":
          if (!elem.from_end) {
            const lloffset = bx.cx().const_usize(elem.offset);
            cg_base = cg_base.project_index(bx, lloffset);
          } else {
            const lloffset = bx.cx().const_usize(elem.offset);
            const lllen = cg_base.len(bx.cx());
            const llindex = bx.sub(lllen, lloffset);
            cg_base = cg_base.project_index(bx, llindex);
          }
          break;
        case "Subslice": {
          const { from, to, from_end } = elem;
          let subslice = cg_base.project_index(bx, bx.cx().const_usize(from));
          const projected_ty = PlaceTy.from_ty(cg_base.layout.ty).projection_ty(tcx, elem, debug_Local).ty;
          // PORT: `subslice.layout = ..` and `subslice.val.llextra = ..` on the `mut` copy build new objects (header).
          subslice = new PlaceRef(subslice.val, bx.cx().layout_of(this.monomorphize(projected_ty, fold_Ty)));

          if (subslice.layout.is_unsized()) {
            assert(from_end, "slice subslices should be `from_end`");
            const llextra = bx.sub(unwrap(cg_base.val.llextra), bx.cx().const_usize(from + to));
            subslice = new PlaceRef(new PlaceValue(subslice.val.llval, llextra, subslice.val.align), subslice.layout);
          }

          cg_base = subslice;
          break;
        }
        case "Downcast":
          cg_base = cg_base.project_downcast(bx, elem._1);
          break;
      }
    }
    // debug!("codegen_place(place={:?}) => {:?}", place_ref, cg_base);
    return cg_base;
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:424 monomorphized_place_ty
  FunctionCx_.prototype.monomorphized_place_ty = function (this: FunctionCx<BackendTypes>, place_ref: mir_PlaceRef): Ty {
    const tcx = this.cx.tcx_();
    const place_ty = place_ref.ty(this.mir, tcx);
    return this.monomorphize(place_ty.ty, fold_Ty);
  };
}

// rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:431 round_up_const_value_to_alignment
function round_up_const_value_to_alignment<B extends BackendTypes>(bx: BuilderMethods<B>, value: B["Value"], align: B["Value"]): B["Value"] {
  // In pseudo code:
  //
  //     if value & (align - 1) == 0 {
  //         value
  //     } else {
  //         (value & !(align - 1)) + align
  //     }
  //
  // Usually this is written without branches as
  //
  //     (value + align - 1) & !(align - 1)
  //
  // But this formula cannot take advantage of constant `value`. E.g. if `value` is known
  // at compile time to be `1`, this expression should be optimized to `align`. However,
  // optimization only holds if `align` is a power of two. Since the optimizer doesn't know
  // that `align` is a power of two, it cannot perform this optimization.
  //
  // Instead we use
  //
  //     value + (-value & (align - 1))
  //
  // Since `align` is used only once, the expression can be optimized. For `value = 0`
  // its optimized to `0` even in debug mode.
  //
  // NB: The previous version of this code used
  //
  //     (value + align - 1) & -align
  //
  // Even though `-align == !(align - 1)`, LLVM failed to optimize this even for
  // `value = 0`. Bug report: https://bugs.llvm.org/show_bug.cgi?id=48559
  const one = bx.const_usize(1n);
  const align_minus_1 = bx.sub(align, one);
  const neg_value = bx.neg(value);
  const offset = bx.and(neg_value, align_minus_1);
  return bx.add(value, offset);
}

/// Calculates the value that needs to be stored to mark the discriminant.
///
/// This might be `None` for a `struct` or a niched variant (like `Some(&3)`).
///
/// If it's `Some`, it returns the value to store and the field in which to
/// store it. Note that this value is *not* the same as the discriminant, in
/// general, as it might be a niche value or have a different size.
///
/// It might also be an `Err` because the variant is uninhabited.
// rustc: compiler/rustc_codegen_ssa/src/mir/place.rs:482 codegen_tag_value
export function codegen_tag_value<B extends BackendTypes>(
  cx: CodegenMethods<B>,
  variant_index: VariantIdx,
  layout: TyAndLayout,
): Result<[FieldIdx, B["Value"]] | undefined, UninhabitedVariantError> {
  // By checking uninhabited-ness first we don't need to worry about types
  // like `(u32, !)` which are single-variant but weird.
  if (layout.is_variant_uninhabited(variant_index)) {
    return Err(UninhabitedVariantError);
  }

  const variants = layout.variants;
  switch (variants.$) {
    case "Empty":
      return unreachable("internal error: entered unreachable code: we already handled uninhabited types");
    case "Single": {
      const index = variants.index;
      assert_eq(index, variant_index, String);
      return Ok(undefined);
    }
    case "Multiple": {
      const tag_field = variants.tag_field;
      const tag_encoding = variants.tag_encoding;
      if (tag_encoding.$ === "Direct") {
        const discr = layout.ty.discriminant_for_variant(cx.tcx_(), variant_index);
        const to = unwrap(discr).val;
        const tag_layout = layout.field(cx, tag_field);
        const tag_llty = cx.immediate_backend_type(tag_layout);
        const imm = cx.const_uint_big(tag_llty, to);
        return Ok([tag_field, imm]);
      } else {
        const { untagged_variant, niche_variants, niche_start } = tag_encoding;
        if (variant_index !== untagged_variant) {
          const niche_layout = layout.field(cx, tag_field);
          const niche_llty = cx.immediate_backend_type(niche_layout);
          const repr = niche_layout.backend_repr;
          if (repr.$ !== "Scalar") {
            return bug("expected a scalar placeref for the niche");
          }
          const scalar = repr._0;
          // We are supposed to compute `niche_value.wrapping_add(niche_start)` wrapping
          // around the `niche`'s type.
          // The easiest way to do that is to do wrapping arithmetic on `u128` and then
          // masking off any extra bits that occur because we did the arithmetic with too many bits.
          // PORT: `u32` subtraction; rustc builds without overflow checks, so it wraps (`>>> 0`).
          const niche_value_u32 = (variant_index - niche_variants.start) >>> 0;
          let niche_value = BigInt.asUintN(128, BigInt(niche_value_u32) + niche_start);
          niche_value = niche_value & niche_layout.size.unsigned_int_max();

          const niche_llval = cx.scalar_to_backend(Scalar.from_uint(niche_value, niche_layout.size), scalar, niche_llty);
          return Ok([tag_field, niche_llval]);
        } else {
          return Ok(undefined);
        }
      }
    }
  }
}

// #[derive(Debug)]
export type UninhabitedVariantError = { readonly __brand: "UninhabitedVariantError" };
/** The unit struct's one value. */
export const UninhabitedVariantError: UninhabitedVariantError = Object.freeze({}) as UninhabitedVariantError;
export const debug_UninhabitedVariantError: Debug<UninhabitedVariantError> = () => "UninhabitedVariantError";
