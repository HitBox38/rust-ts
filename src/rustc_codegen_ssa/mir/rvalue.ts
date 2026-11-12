// Port of compiler/rustc_codegen_ssa/src/mir/rvalue.rs (lane ssa-rvalue-intrinsic, plan-m7 wave 41).
//
// PORT (ssa-rvalue-intrinsic): conventions as place.ts's and operand.ts's headers:
// - The `impl FunctionCx` block (`try_codegen_const_aggregate_as_immediate` .. `codegen_scalar_checked_binop`) is in
//   `install_FunctionCx_rvalue`, which mod.ts calls right after `class FunctionCx`; this file imports mod.ts for types
//   and for the `xlane` table only (used inside method bodies, never at load time).
// - Copy semantics: `OperandRef`/`PlaceRef` are not written in place; `OperandRef { val, layout, move_annotation }`
//   literals are `new OperandRef(val, layout, move_annotation)`.
// - `{:?}` of a backend value uses `bx.debug_Value` (place.ts header).
// - `debug!`/`#[instrument(level = "trace")]` are compiled out of rustc (STATIC_MAX_LEVEL = INFO) and stay comments.
// - constant.rs `FunctionCx::eval_mir_constant` (ssa-mir-rest) is the installed method, and base.rs's
//   `coerce_unsized_into`, `unsize_ptr`, `build_shift_expr_rhs` (ssa-base) are imported (root at integ-w54; they were stubs). retag.rs `codegen_retag_operand` goes through mod.ts's `xlane` entry.
import {
  AddressSpace,
  type Align,
  BackendRepr,
  debug_BackendRepr,
  FIRST_VARIANT,
  FieldsShape,
  type FieldIdx,
  Scalar as abi_Scalar,
  Scalar_eq as abi_Scalar_eq,
  type Size,
  Size_cmp,
  Size_eq,
  debug_Scalar as debug_abi_Scalar,
  debug_Size,
} from "../../rustc_abi/lib.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { TyCtxt_codegen_instance_attrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import {
  type AggregateKind,
  BinOp,
  BorrowKind,
  ConstValue,
  debug_BinOp,
  debug_CastKind,
  type Operand as mir_Operand,
  type Place as mir_Place,
  RawPtrKind,
  Rvalue,
  WithRetag,
} from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { debug_TyAndLayout_Ty, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { debug_Ty, Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches, Panic, unreachable, unwrap } from "../../std/panic.ts";
import { bin_op_to_fcmp_predicate, bin_op_to_icmp_predicate } from "../base.ts";
import { debug_TypeKind, IntPredicate, TypeKind } from "../common.ts";
import { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import { type BuilderMethods, OverflowOp, ReturnSlot } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx } from "./mod.ts";
import { xlane } from "./mod.ts";
import { debug_OperandRef, debug_OperandValue, OperandRef, OperandRefBuilder, OperandValue } from "./operand.ts";
import { codegen_tag_value, PlaceRef, PlaceValue } from "./place.ts";
import { build_shift_expr_rhs, coerce_unsized_into, unsize_ptr } from "../base.ts";

// ---- impl FunctionCx (rvalue.rs:22) ----------------------------------------------------------------------------------

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    try_codegen_const_aggregate_as_immediate(bx: Bx, dest: PlaceRef<B["Value"]>, kind: AggregateKind, operands: readonly mir_Operand[]): boolean;
    is_entirely_uninit_const(operand: mir_Operand): boolean;
    codegen_rvalue(bx: Bx, dest: PlaceRef<B["Value"]>, rvalue: Rvalue): void;
    codegen_transmute(bx: Bx, src: OperandRef<B["Value"]>, dst: PlaceRef<B["Value"]>): void;
    codegen_transmute_operand(bx: Bx, operand: OperandRef<B["Value"]>, cast: TyAndLayout): OperandValue<B["Value"]>;
    cast_immediate(
      bx: Bx,
      imm: B["Value"],
      from_scalar: abi_Scalar,
      from_backend_ty: B["Type"],
      to_scalar: abi_Scalar,
      to_backend_ty: B["Type"],
    ): B["Value"] | undefined;
    codegen_rvalue_operand(bx: Bx, rvalue: Rvalue): OperandRef<B["Value"]>;
    codegen_place_to_pointer(bx: Bx, place: mir_Place, mk_ptr_ty: (tcx: TyCtxt, ty: Ty) => Ty): OperandRef<B["Value"]>;
    codegen_scalar_binop(bx: Bx, op: BinOp, lhs: B["Value"], rhs: B["Value"], lhs_ty: Ty, rhs_ty: Ty): B["Value"];
    codegen_wide_ptr_binop(
      bx: Bx,
      op: BinOp,
      lhs_addr: B["Value"],
      lhs_extra: B["Value"],
      rhs_addr: B["Value"],
      rhs_extra: B["Value"],
      _input_ty: Ty,
    ): B["Value"];
    codegen_scalar_checked_binop(bx: Bx, op: BinOp, lhs: B["Value"], rhs: B["Value"], input_ty: Ty): OperandValue<B["Value"]>;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of rvalue.rs; mod.ts calls this once,
 *  right after its `class FunctionCx` (header). */
export function install_FunctionCx_rvalue(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:23 try_codegen_const_aggregate_as_immediate
  FunctionCx_.prototype.try_codegen_const_aggregate_as_immediate = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    dest: PlaceRef<unknown>,
    kind: AggregateKind,
    operands: readonly mir_Operand[],
  ): boolean {
    // Keep this allowlist limited to aggregate kinds with direct codegen coverage.
    // Extract the variant index at the same time so we can verify it against
    // the layout below. Tuples always use `FIRST_VARIANT` (index 0); the
    // `None` in the `Adt` arm excludes unions (which carry an active field).
    let variant_index;
    if (kind.$ === "Tuple") {
      variant_index = FIRST_VARIANT;
    } else if (kind.$ === "Adt" && kind._4 === undefined) {
      variant_index = kind._1;
    } else {
      return false;
    }
    if (dest.layout.fields.$ !== "Arbitrary") {
      return false;
    }
    // `dest.layout` is the layout of the *overall* type, not a specific
    // variant. When the layout is `Variants::Single { index: M }`, the
    // field offsets and counts below all refer to variant M. If the MIR
    // aggregate is constructing a different variant N (e.g. because N is
    // uninhabited and the layout collapsed to M), using `dest.layout`
    // directly would read the wrong field metadata. Bail out and let the
    // normal codegen path handle it via `project_downcast`.
    const variants = dest.layout.variants;
    if (!(variants.$ === "Single" && variants.index === variant_index)) {
      return false;
    }
    // Now that the variant indices are known to match, the operand count
    // and the layout field count must agree.
    // debug_assert_eq!(operands.len(), dest.layout.fields.count());

    const size = dest.layout.size.bytes();
    let llty;
    switch (size) {
      case 1:
        llty = bx.cx().type_i8();
        break;
      case 2:
        llty = bx.cx().type_i16();
        break;
      case 4:
        llty = bx.cx().type_i32();
        break;
      case 8:
        llty = bx.cx().type_i64();
        break;
      case 16:
        llty = bx.cx().type_i128();
        break;
      default:
        return false;
    }

    let value = 0n;
    for (let field_idx = 0; field_idx < operands.length; field_idx++) {
      const operand = operands[field_idx]!;
      const field_layout = dest.layout.field(bx.cx(), field_idx);
      if (field_layout.is_zst()) {
        continue;
      }
      if (operand.$ !== "Constant") {
        return false;
      }
      const constant = operand._0;
      const field_value = ConstValue.try_to_bits(this.eval_mir_constant(constant), field_layout.size);
      if (field_value === undefined) {
        return false;
      }

      const field_size = field_layout.size.bytes();
      const field_offset = FieldsShape.offset(dest.layout.fields, field_idx).bytes();
      // debug_assert!(field_offset + field_size <= size);
      let shift: number;
      switch (bx.tcx_().data_layout().endian) {
        case "Little":
          shift = field_offset * 8;
          break;
        case "Big":
          shift = (size - field_offset - field_size) * 8;
          break;
      }
      value |= field_value << BigInt(shift);
    }

    const value_ = bx.cx().const_uint_big(llty, value);
    bx.store_to_place(value_, dest.val);
    return true;
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:96 is_entirely_uninit_const
  FunctionCx_.prototype.is_entirely_uninit_const = function (this: FunctionCx<BackendTypes>, operand: mir_Operand): boolean {
    if (operand.$ !== "Constant") return false;
    const const_op = operand._0;
    return ConstValue.all_bytes_uninit(this.eval_mir_constant(const_op), this.cx.tcx_());
  };

  // #[instrument(level = "trace", skip(self, bx))]
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:102 codegen_rvalue
  FunctionCx_.prototype.codegen_rvalue = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    dest: PlaceRef<unknown>,
    rvalue: Rvalue,
  ): void {
    if (rvalue.$ === "Use") {
      const operand = rvalue._0;
      const with_retag = rvalue._1;
      if (this.is_entirely_uninit_const(operand)) {
        return;
      }
      const cg_operand = this.codegen_operand(bx, operand);
      // Crucially, we do *not* use `OperandValue::Ref` for types with
      // `BackendRepr::Scalar | BackendRepr::ScalarPair`. This ensures we match the MIR
      // semantics regarding when assignment operators allow overlap of LHS and RHS.
      if (cg_operand.layout.backend_repr.$ === "Scalar" || cg_operand.layout.backend_repr.$ === "ScalarPair") {
        // debug_assert!(!matches!(cg_operand.val, OperandValue::Ref(..)));
      }
      // If this is storing a &Freeze reference with a retag, record that it's not
      // possible to perform writes through the stored pointer.
      const kind = cg_operand.layout.ty.kind();
      let flags: MemFlags;
      if (kind.$ === "Ref" && kind._2 === "Not" && WithRetag.yes(with_retag) && kind._1.is_freeze(this.cx.tcx_(), this.cx.typing_env_())) {
        flags = MemFlags.CAPTURES_READ_ONLY;
      } else {
        flags = MemFlags.empty();
      }
      // FIXME: consider not copying constants through stack. (Fixable by codegen'ing
      // constants into `OperandValue::Ref`; why don’t we do that yet if we don’t?)
      cg_operand.store_with_annotation_and_flags(bx, dest, flags);
    } else if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "Unsize") {
      const source = rvalue._1;
      // The destination necessarily contains a wide pointer, so if
      // it's a scalar pair, it's a wide pointer or newtype thereof.
      if (dest.layout.backend_repr.$ === "ScalarPair") {
        // Into-coerce of a thin pointer to a wide pointer -- just
        // use the operand path.
        const temp = this.codegen_rvalue_operand(bx, rvalue);
        temp.store_with_annotation(bx, dest);
        return;
      }

      // Unsize of a nontrivial struct. I would prefer for
      // this to be eliminated by MIR building, but
      // `CoerceUnsized` can be passed by a where-clause,
      // so the (generic) MIR may not be able to expand it.
      const operand = this.codegen_operand(bx, source);
      const val = operand.val;
      switch (val.$) {
        case "Pair":
        case "Immediate": {
          // Unsize from an immediate structure. We don't
          // really need a temporary alloca here, but
          // avoiding it would require us to have
          // `coerce_unsized_into` use `extractvalue` to
          // index into the struct, and this case isn't
          // important enough for it.
          // debug!("codegen_rvalue: creating ugly alloca");
          const scratch = PlaceRef.alloca(bx, operand.layout);
          scratch.storage_live(bx);
          operand.store_with_annotation(bx, scratch);
          coerce_unsized_into(bx, scratch, dest);
          scratch.storage_dead(bx);
          break;
        }
        case "Ref": {
          const val_ = val._0;
          if (val_.llextra !== undefined) {
            bug("unsized coercion on an unsized rvalue");
          }
          coerce_unsized_into(bx, val_.with_type(operand.layout, bx.debug_Value), dest);
          break;
        }
        case "ZeroSized":
          bug("unsized coercion on a ZST rvalue");
      }
    } else if (rvalue.$ === "Cast" && (rvalue._0.$ === "Transmute" || rvalue._0.$ === "Subtype")) {
      const operand = rvalue._1;
      const src = this.codegen_operand(bx, operand);
      this.codegen_transmute(bx, src, dest);
    } else if (rvalue.$ === "Repeat") {
      const elem = rvalue._0;
      const count = rvalue._1;
      // Do not generate the loop for zero-sized elements or empty arrays.
      if (dest.layout.is_zst()) {
        return;
      }

      // When the element is a const with all bytes uninit, emit a single memset that
      // writes undef to the entire destination.
      if (this.is_entirely_uninit_const(elem)) {
        const size = bx.const_usize(dest.layout.size.bytes_u64());
        bx.memset(dest.val.llval, bx.const_undef(bx.type_i8()), size, dest.val.align, MemFlags.empty());
        return;
      }

      const cg_elem = this.codegen_operand(bx, elem);

      const try_init_all_same = (bx: BuilderMethods<BackendTypes>, v: unknown): boolean => {
        const start = dest.val.llval;
        const size = bx.const_usize(dest.layout.size.bytes_u64());

        // Use llvm.memset.p0i8.* to initialize all same byte arrays
        const int = bx.cx().const_to_opt_u128(v, false);
        if (int !== undefined) {
          const bytes = u128_to_le_bytes(int).slice(0, cg_elem.layout.size.bytes_usize());
          const byte = all_equal_value(bytes);
          if (byte !== undefined) {
            const fill = bx.cx().const_u8(byte);
            bx.memset(start, fill, size, dest.val.align, MemFlags.empty());
            return true;
          }
        }

        // Use llvm.memset.p0i8.* to initialize byte arrays
        const v_ = bx.from_immediate(v);
        if (bx.cx().val_ty(v_) === bx.cx().type_i8()) {
          bx.memset(start, v_, size, dest.val.align, MemFlags.empty());
          return true;
        }
        return false;
      };

      if (cg_elem.val.$ === "Immediate" && try_init_all_same(bx, cg_elem.val._0)) {
        return;
      }

      const count_ = unwrap(this.monomorphize(count, fold_Const).try_to_target_usize(bx.tcx_()), "expected monomorphic const in codegen");

      bx.write_operand_repeatedly(cg_elem, count_, dest);
    } else if (
      // This implementation does field projection, so never use it for `RawPtr`,
      // which will always be fine with the `codegen_rvalue_operand` path below.
      rvalue.$ === "Aggregate" &&
      rvalue._0.$ !== "RawPtr"
    ) {
      const kind = rvalue._0;
      const operands = rvalue._1;
      if (this.try_codegen_const_aggregate_as_immediate(bx, dest, kind, operands)) {
        return;
      }

      let variant_index;
      let variant_dest;
      let active_field_index;
      if (kind.$ === "Adt") {
        variant_index = kind._1;
        active_field_index = kind._4;
        variant_dest = dest.project_downcast(bx, variant_index);
      } else {
        [variant_index, variant_dest, active_field_index] = [FIRST_VARIANT, dest, undefined];
      }
      if (active_field_index !== undefined) {
        assert_eq(operands.length, 1, String);
      }
      for (let i = 0; i < operands.length; i++) {
        const operand = operands[i]!;
        // Do not generate stores for entirely uninit constant fields, for the same
        // reason as in `Rvalue::Use` above.
        if (this.is_entirely_uninit_const(operand)) {
          continue;
        }
        const op = this.codegen_operand(bx, operand);
        // Do not generate stores and GEPis for zero-sized fields.
        if (!op.layout.is_zst()) {
          const field_index = active_field_index ?? (i as FieldIdx);
          let field;
          if (kind.$ === "Array") {
            const llindex = bx.cx().const_usize(BigInt(field_index));
            field = variant_dest.project_index(bx, llindex);
          } else {
            field = variant_dest.project_field(bx, field_index);
          }
          op.store_with_annotation(bx, field);
        }
      }
      dest.codegen_set_discr(bx, variant_index);
    } else {
      const temp = this.codegen_rvalue_operand(bx, rvalue);
      temp.store_with_annotation(bx, dest);
    }
  };

  /// Transmutes the `src` value to the destination type by writing it to `dst`.
  ///
  /// See also [`Self::codegen_transmute_operand`] for cases that can be done
  /// without needing a pre-allocated place for the destination.
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:306 codegen_transmute
  FunctionCx_.prototype.codegen_transmute = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    src: OperandRef<unknown>,
    dst: PlaceRef<unknown>,
  ): void {
    // The MIR validator enforces no unsized transmutes.
    assert(src.layout.is_sized(), "assertion failed: src.layout.is_sized()");
    assert(dst.layout.is_sized(), "assertion failed: dst.layout.is_sized()");

    if (!Size_eq(src.layout.size, dst.layout.size) || src.layout.is_uninhabited() || dst.layout.is_uninhabited()) {
      // These cases are all UB to actually hit, so don't emit code for them.
      // (The size mismatches are reachable via `transmute_unchecked`.)
      bx.unreachable_nonterminator();
    } else {
      // Since in this path we have a place anyway, we can store or copy to it,
      // making sure we use the destination place's alignment even if the
      // source would normally have a higher one.
      src.store_with_annotation(bx, dst.val.with_type(src.layout, bx.debug_Value));
    }
  };

  /// Transmutes an `OperandValue` to another `OperandValue`.
  ///
  /// This is supported for all cases where the `cast` type is SSA,
  /// but for non-ZSTs with [`abi::BackendRepr::Memory`] it ICEs.
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:335 codegen_transmute_operand
  FunctionCx_.prototype.codegen_transmute_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    operand: OperandRef<unknown>,
    cast: TyAndLayout,
  ): OperandValue<unknown> {
    if (cast.backend_repr.$ === "Memory" && !cast.is_zst()) {
      span_bug(this.mir.span, `Use \`codegen_transmute\` to transmute to ${format_debug(cast, debug_TyAndLayout_Ty, PLAIN)}`);
    }

    // `Layout` is interned, so we can do a cheap check for things that are
    // exactly the same and thus don't need any handling.
    // PORT: `abi::Layout::eq` is pointer equality of the interned layouts: `===`.
    if (operand.layout.layout === cast.layout) {
      return operand.val;
    }

    // Check for transmutes that are always UB.
    if (!Size_eq(operand.layout.size, cast.size) || operand.layout.is_uninhabited() || cast.is_uninhabited()) {
      bx.unreachable_nonterminator();

      // We still need to return a value of the appropriate type, but
      // it's already UB so do the easiest thing available.
      return OperandValue.poison(bx, cast);
    }

    // To or from pointers takes different methods, so we use this to restrict
    // the SimdVector case to types which can be `bitcast` between each other.
    // (vector_can_bitcast, below)

    const cx = bx.cx();
    const val = operand.val;
    const from = operand.layout.backend_repr;
    const to = cast.backend_repr;
    if (cast.is_zst()) {
      return OperandValue.ZeroSized;
    } else if (val.$ === "Ref" && from.$ === "Memory") {
      const source_place_val = val._0;
      assert_eq(source_place_val.llextra, undefined, (v) => (v === undefined ? "None" : `Some(${bx.debug_Value(v, PLAIN)})`));
      // The existing alignment is part of `source_place_val`,
      // so that alignment will be used, not `cast`'s.
      return bx.load_operand(source_place_val.with_type(cast, bx.debug_Value)).val;
    } else if (
      val.$ === "Immediate" &&
      from.$ === "Scalar" &&
      to.$ === "Scalar" &&
      Size_eq(abi_Scalar.size(from._0, cx), abi_Scalar.size(to._0, cx))
    ) {
      return { $: "Immediate", _0: transmute_scalar(bx, val._0, from._0, to._0) };
    } else if (
      val.$ === "Immediate" &&
      from.$ === "SimdVector" &&
      to.$ === "SimdVector" &&
      vector_can_bitcast(from.element) &&
      vector_can_bitcast(to.element)
    ) {
      const to_backend_ty = bx.cx().immediate_backend_type(cast);
      return { $: "Immediate", _0: bx.bitcast(val._0, to_backend_ty) };
    } else if (
      val.$ === "Immediate" &&
      from.$ === "SimdScalableVector" &&
      to.$ === "SimdScalableVector" &&
      vector_can_bitcast(from.element) &&
      vector_can_bitcast(to.element)
    ) {
      const to_backend_ty = bx.cx().immediate_backend_type(cast);
      return { $: "Immediate", _0: bx.bitcast(val._0, to_backend_ty) };
    } else if (
      val.$ === "Pair" &&
      from.$ === "ScalarPair" &&
      to.$ === "ScalarPair" &&
      Size_eq(abi_Scalar.size(from.a, cx), abi_Scalar.size(to.a, cx)) &&
      Size_eq(abi_Scalar.size(from.b, cx), abi_Scalar.size(to.b, cx)) &&
      Size_eq(from.b_offset, to.b_offset)
    ) {
      const [imm_a, imm_b] = [val._0, val._1];
      const [in_a, in_b] = [from.a, from.b];
      const [out_a, out_b] = [to.a, to.b];
      return { $: "Pair", _0: transmute_scalar(bx, imm_a, in_a, out_a), _1: transmute_scalar(bx, imm_b, in_b, out_b) };
    } else {
      // For any other potentially-tricky cases, make a temporary instead.
      // If anything else wants the target local to be in memory this won't
      // be hit, as `codegen_transmute` will get called directly. Thus this
      // is only for places where everything else wants the operand form,
      // and thus it's not worth making those places get it from memory.
      //
      // Notably, Scalar ⇌ ScalarPair cases go here to avoid padding
      // and endianness issues, as do SimdVector ones to avoid worrying
      // about things like f32x8 ⇌ ptrx4 that would need multiple steps.
      const align = Align_max(operand.layout.align.abi, cast.align.abi);
      const size = Size_max(operand.layout.size, cast.size);
      const temp = PlaceValue.alloca(bx, size, align);
      bx.lifetime_start(temp.llval, size);
      operand.store_with_annotation(bx, temp.with_type(operand.layout, bx.debug_Value));
      const val_ = bx.load_operand(temp.with_type(cast, bx.debug_Value)).val;
      bx.lifetime_end(temp.llval, size);
      return val_;
    }
  };

  /// Cast one of the immediates from an [`OperandValue::Immediate`]
  /// or an [`OperandValue::Pair`] to an immediate of the target type.
  ///
  /// Returns `None` if the cast is not possible.
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:449 cast_immediate
  FunctionCx_.prototype.cast_immediate = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    imm: unknown,
    from_scalar: abi_Scalar,
    from_backend_ty: unknown,
    to_scalar: abi_Scalar,
    to_backend_ty: unknown,
  ): unknown {
    // use abi::Primitive::*;

    // When scalars are passed by value, there's no metadata recording their
    // valid ranges. For example, `char`s are passed as just `i32`, with no
    // way for LLVM to know that they're 0x10FFFF at most. Thus we assume
    // the range of the input value too, not just the output range.
    assume_scalar_range(bx, imm, from_scalar, from_backend_ty, undefined);

    const from = abi_Scalar.primitive(from_scalar);
    const to = abi_Scalar.primitive(to_scalar);
    if (from.$ === "Int" && to.$ === "Int") {
      const is_signed = from._1;
      imm = bx.intcast(imm, to_backend_ty, is_signed);
    } else if (from.$ === "Float" && to.$ === "Float") {
      const srcsz = bx.cx().float_width(from_backend_ty);
      const dstsz = bx.cx().float_width(to_backend_ty);
      if (dstsz > srcsz) {
        imm = bx.fpext(imm, to_backend_ty);
      } else if (srcsz > dstsz) {
        imm = bx.fptrunc(imm, to_backend_ty);
      } else {
        // imm
      }
    } else if (from.$ === "Int" && to.$ === "Float") {
      const is_signed = from._1;
      if (is_signed) {
        imm = bx.sitofp(imm, to_backend_ty);
      } else {
        imm = bx.uitofp(imm, to_backend_ty);
      }
    } else if (from.$ === "Pointer" && to.$ === "Pointer") {
      imm = bx.pointercast(imm, to_backend_ty);
    } else if (from.$ === "Int" && to.$ === "Pointer") {
      const is_signed = from._1;
      const usize_imm = bx.intcast(imm, bx.cx().type_isize(), is_signed);
      imm = bx.inttoptr(usize_imm, to_backend_ty);
    } else if (from.$ === "Float" && to.$ === "Int") {
      const is_signed = to._1;
      imm = bx.cast_float_to_int(is_signed, imm, to_backend_ty);
    } else {
      return undefined;
    }
    return imm;
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:497 codegen_rvalue_operand
  FunctionCx_.prototype.codegen_rvalue_operand = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    rvalue: Rvalue,
  ): OperandRef<unknown> {
    switch (rvalue.$) {
      case "Cast": {
        const kind = rvalue._0;
        const source = rvalue._1;
        const mir_cast_ty = rvalue._2;
        const operand = this.codegen_operand(bx, source);
        // debug!("cast operand is {:?}", operand);
        const cast = bx.cx().layout_of(this.monomorphize(mir_cast_ty, fold_Ty));

        let val: OperandValue<unknown>;
        if (kind.$ === "PointerExposeProvenance") {
          assert(BackendRepr.is_scalar_or_simd(cast.backend_repr), "assertion failed: cast.backend_repr.is_scalar_or_simd()");
          const llptr = operand.immediate(bx.debug_Value);
          const llcast_ty = bx.cx().immediate_backend_type(cast);
          const lladdr = bx.ptrtoint(llptr, llcast_ty);
          val = { $: "Immediate", _0: lladdr };
        } else if (kind.$ === "PointerCoercion" && kind._0.$ === "ReifyFnPointer") {
          const k = operand.layout.ty.kind();
          if (k.$ === "FnDef") {
            const def_id = k._0;
            const args = k._1;
            const instance = unwrap(Instance.resolve_for_fn_ptr(bx.tcx_(), bx.typing_env_(), def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs))));
            val = { $: "Immediate", _0: bx.get_fn_addr(instance, bx.sess().pointer_authentication_functions()) };
          } else {
            return bug(`${display_Ty(operand.layout.ty)} cannot be reified to a fn ptr`);
          }
        } else if (kind.$ === "PointerCoercion" && kind._0.$ === "ClosureFnPointer") {
          const k = operand.layout.ty.kind();
          if (k.$ === "Closure") {
            const def_id = k._0;
            const args = k._1;
            const instance = Instance.resolve_closure(bx.cx().tcx_(), def_id, args, "FnOnce");
            val = { $: "Immediate", _0: bx.cx().get_fn_addr(instance, bx.sess().pointer_authentication_functions()) };
          } else {
            return bug(`${display_Ty(operand.layout.ty)} cannot be cast to a fn ptr`);
          }
        } else if (kind.$ === "PointerCoercion" && kind._0.$ === "UnsafeFnPointer") {
          // This is a no-op at the LLVM level.
          val = operand.val;
        } else if (kind.$ === "PointerCoercion" && kind._0.$ === "Unsize") {
          assert_matches(cast.backend_repr, cast.backend_repr.$ === "ScalarPair", "BackendRepr::ScalarPair { .. }", (v) => debug_BackendRepr(v, PLAIN));
          const [lldata0, llextra0] = OperandValue.pointer_parts(operand.val, bx.debug_Value);
          const [lldata, llextra] = unsize_ptr(bx, lldata0, operand.layout.ty, cast.ty, llextra0);
          val = { $: "Pair", _0: lldata, _1: llextra };
        } else if (kind.$ === "PointerCoercion" && (kind._0.$ === "MutToConstPointer" || kind._0.$ === "ArrayToPointer")) {
          return bug(`${format_debug(kind, debug_CastKind, PLAIN)} is for borrowck, and should never appear in codegen`);
        } else if (kind.$ === "PtrToPtr" && operand.layout.backend_repr.$ === "ScalarPair") {
          const ov = operand.val;
          if (ov.$ === "Pair") {
            const [data_ptr, meta] = [ov._0, ov._1];
            if (cast.backend_repr.$ === "ScalarPair") {
              val = { $: "Pair", _0: data_ptr, _1: meta };
            } else {
              // Cast of wide-ptr to thin-ptr is an extraction of data-ptr.
              val = { $: "Immediate", _0: data_ptr };
            }
          } else {
            return bug("unexpected non-pair operand");
          }
        } else if (
          kind.$ === "IntToInt" ||
          kind.$ === "FloatToInt" ||
          kind.$ === "FloatToFloat" ||
          kind.$ === "IntToFloat" ||
          kind.$ === "PtrToPtr" ||
          kind.$ === "FnPtrToPtr" ||
          // Since int2ptr can have arbitrary integer types as input (so we have to do
          // sign extension and all that), it is currently best handled in the same code
          // path as the other integer-to-X casts.
          kind.$ === "PointerWithExposedProvenance"
        ) {
          const imm = operand.immediate(bx.debug_Value);
          const from_repr = operand.layout.backend_repr;
          if (from_repr.$ !== "Scalar") {
            return bug(`Found non-scalar for operand ${debug_OperandRef(operand, PLAIN, bx.debug_Value)}`);
          }
          const from_scalar = from_repr._0;
          const from_backend_ty = bx.cx().immediate_backend_type(operand.layout);

          assert(BackendRepr.is_scalar_or_simd(cast.backend_repr), "assertion failed: cast.backend_repr.is_scalar_or_simd()");
          const to_backend_ty = bx.cx().immediate_backend_type(cast);
          if (operand.layout.is_uninhabited()) {
            const val_: OperandValue<unknown> = { $: "Immediate", _0: bx.cx().const_poison(to_backend_ty) };
            return new OperandRef(val_, cast, undefined);
          }
          const to_repr = cast.backend_repr;
          if (to_repr.$ !== "Scalar") {
            return bug(`Found non-scalar for cast ${format_debug(cast, debug_TyAndLayout_Ty, PLAIN)}`);
          }
          const to_scalar = to_repr._0;

          const r = this.cast_immediate(bx, imm, from_scalar, from_backend_ty, to_scalar, to_backend_ty);
          if (r === undefined) {
            return bug(`Unsupported cast of ${debug_OperandRef(operand, PLAIN, bx.debug_Value)} to ${format_debug(cast, debug_TyAndLayout_Ty, PLAIN)}`);
          }
          val = { $: "Immediate", _0: r };
        } else if (kind.$ === "Transmute" || kind.$ === "BoxDerefTransmute" || kind.$ === "Subtype") {
          val = this.codegen_transmute_operand(bx, operand, cast);
        } else {
          // PORT: the arms above are exhaustive over `CastKind` (`PtrToPtr` without a pair falls to the scalar arm).
          return unreachable();
        }
        return new OperandRef(val, cast, undefined);
      }

      case "Ref": {
        const bk = rvalue._1;
        const place = rvalue._2;
        const mk_ref = (tcx: TyCtxt, ty: Ty): Ty => Ty.new_ref(tcx, tcx.lifetimes.re_erased, ty, BorrowKind.to_mutbl_lossy(bk));
        const op = this.codegen_place_to_pointer(bx, place, mk_ref);
        if (this.cx.tcx_().sess.opts.unstable_opts.codegen_emit_retag !== undefined) {
          return xlane.codegen_retag_operand(this, bx, op, false);
        } else {
          return op;
        }
      }

      // Note: Exclusive reborrowing is always equal to a memcpy, as the types do not change.
      // Generic shared reborrowing is not (necessarily) a simple memcpy, but currently the
      // coherence check places such restrictions on the CoerceShared trait as to guarantee
      // that it is.
      case "Reborrow": {
        const place = rvalue._2;
        return this.codegen_operand(bx, { $: "Copy", _0: place });
      }

      case "RawPtr": {
        const kind = rvalue._0;
        const place = rvalue._1;
        const mk_ptr = (tcx: TyCtxt, ty: Ty): Ty => Ty.new_ptr(tcx, ty, RawPtrKind.to_mutbl_lossy(kind));
        return this.codegen_place_to_pointer(bx, place, mk_ptr);
      }

      case "BinaryOp": {
        const op_with_overflow = rvalue._0;
        const op = BinOp.overflowing_to_wrapping(op_with_overflow);
        if (op !== undefined) {
          const lhs = this.codegen_operand(bx, rvalue._1[0]);
          const rhs = this.codegen_operand(bx, rvalue._1[1]);
          const result = this.codegen_scalar_checked_binop(bx, op, lhs.immediate(bx.debug_Value), rhs.immediate(bx.debug_Value), lhs.layout.ty);
          const val_ty = BinOp.ty(op, bx.tcx_(), lhs.layout.ty, rhs.layout.ty);
          const operand_ty = Ty.new_tup(bx.tcx_(), [val_ty, bx.tcx_().types.bool]);
          return new OperandRef(result, bx.cx().layout_of(operand_ty), undefined);
        }

        const op_ = op_with_overflow;
        const lhs = this.codegen_operand(bx, rvalue._1[0]);
        const rhs = this.codegen_operand(bx, rvalue._1[1]);
        let llresult;
        const [lv, rv] = [lhs.val, rhs.val];
        if (lv.$ === "Pair" && rv.$ === "Pair") {
          const [lhs_addr, lhs_extra] = [lv._0, lv._1];
          const [rhs_addr, rhs_extra] = [rv._0, rv._1];
          llresult = this.codegen_wide_ptr_binop(bx, op_, lhs_addr, lhs_extra, rhs_addr, rhs_extra, lhs.layout.ty);
        } else if (lv.$ === "Immediate" && rv.$ === "Immediate") {
          const [lhs_val, rhs_val] = [lv._0, rv._0];
          llresult = this.codegen_scalar_binop(bx, op_, lhs_val, rhs_val, lhs.layout.ty, rhs.layout.ty);
        } else {
          return bug();
        }
        return new OperandRef({ $: "Immediate", _0: llresult }, bx.cx().layout_of(BinOp.ty(op_, bx.tcx_(), lhs.layout.ty, rhs.layout.ty)), undefined);
      }

      case "UnaryOp": {
        const op = rvalue._0;
        const operand = this.codegen_operand(bx, rvalue._1);
        const is_float = operand.layout.ty.is_floating_point();
        let val: OperandValue<unknown>;
        let layout: TyAndLayout;
        switch (op) {
          case "Not": {
            const llval = bx.not(operand.immediate(bx.debug_Value));
            [val, layout] = [{ $: "Immediate", _0: llval }, operand.layout];
            break;
          }
          case "Neg": {
            let llval;
            if (is_float) {
              llval = bx.fneg(operand.immediate(bx.debug_Value));
            } else {
              llval = bx.neg(operand.immediate(bx.debug_Value));
            }
            [val, layout] = [{ $: "Immediate", _0: llval }, operand.layout];
            break;
          }
          case "PtrMetadata": {
            assert(operand.layout.ty.is_raw_ptr() || operand.layout.ty.is_ref(), "assertion failed: operand.layout.ty.is_raw_ptr() || operand.layout.ty.is_ref()");
            const [, meta] = OperandValue.pointer_parts(operand.val, bx.debug_Value);
            assert_eq(FieldsShape.count(operand.layout.fields) > 1, meta !== undefined, String);
            if (meta !== undefined) {
              [val, layout] = [{ $: "Immediate", _0: meta }, operand.layout.field(this.cx, 1)];
            } else {
              [val, layout] = [OperandValue.ZeroSized, bx.cx().layout_of(bx.tcx_().types.unit)];
            }
            break;
          }
        }
        const val_ = val;
        const layout_ = layout;
        assert(
          OperandValue.is_expected_variant_for_type(val, layout),
          () => `Made wrong variant ${debug_OperandValue(val_, PLAIN, bx.debug_Value)} for type ${format_debug(layout_, debug_TyAndLayout_Ty, PLAIN)}`,
        );
        return new OperandRef(val, layout, undefined);
      }

      case "Discriminant": {
        const place = rvalue._0;
        const discr_ty0 = Rvalue.ty(rvalue, this.mir, bx.tcx_());
        const discr_ty = this.monomorphize(discr_ty0, fold_Ty);
        const operand = this.codegen_consume(bx, place.as_ref());
        const discr = operand.codegen_get_discr(this, bx, discr_ty);
        return new OperandRef({ $: "Immediate", _0: discr }, this.cx.layout_of(discr_ty), undefined);
      }

      case "ThreadLocalRef": {
        const def_id = rvalue._0;
        assert(bx.cx().tcx_().is_static(def_id), "assertion failed: bx.cx().tcx().is_static(def_id)");
        const layout = bx.layout_of(bx.cx().tcx_().static_ptr_ty(def_id, bx.typing_env_()));
        let static_;
        if (!def_id.is_local() && bx.cx().tcx_().needs_thread_local_shim(def_id)) {
          const instance: Instance = {
            def: { $: "Shim", _0: { $: "ThreadLocal", _0: def_id } },
            args: RawList.empty(),
          };
          const fn_ptr = bx.get_fn_addr(instance, bx.sess().pointer_authentication_functions());
          const fn_abi = bx.fn_abi_of_instance(instance, RawList.empty());
          const fn_ty = bx.fn_decl_backend_type(fn_abi);
          let fn_attrs;
          if (DefKind.has_codegen_attrs(bx.tcx_().def_kind(Instance.def_id(instance)))) {
            fn_attrs = TyCtxt_codegen_instance_attrs(bx.tcx_(), instance.def);
          } else {
            fn_attrs = undefined;
          }
          static_ = bx.call(fn_ty, fn_attrs, fn_abi, fn_ptr, ReturnSlot.Direct, [], undefined, instance);
        } else {
          static_ = bx.get_static(def_id);
        }
        return new OperandRef({ $: "Immediate", _0: static_ }, layout, undefined);
      }

      case "Use": {
        const operand = rvalue._0;
        return this.codegen_operand(bx, operand);
      }

      case "Repeat": {
        const elem = rvalue._0;
        const len_const = rvalue._1;
        // All arrays have `BackendRepr::Memory`, so only the ZST cases
        // end up here. Anything else forces the destination local to be
        // `Memory`, and thus ends up handled in `codegen_rvalue` instead.
        const operand = this.codegen_operand(bx, elem);
        const array_ty0 = Ty.new_array_with_const_len(bx.tcx_(), operand.layout.ty, len_const);
        const array_ty = this.monomorphize(array_ty0, fold_Ty);
        const array_layout = bx.layout_of(array_ty);
        assert(array_layout.is_zst(), "assertion failed: array_layout.is_zst()");
        return new OperandRef(OperandValue.ZeroSized, array_layout, undefined);
      }

      case "Aggregate": {
        const kind = rvalue._0;
        const fields = rvalue._1;
        let variant_index;
        let active_field_index;
        if (kind.$ === "Adt") {
          [variant_index, active_field_index] = [kind._1, kind._4];
        } else {
          [variant_index, active_field_index] = [FIRST_VARIANT, undefined];
        }

        const ty0 = Rvalue.ty(rvalue, this.mir, this.cx.tcx_());
        const ty = this.monomorphize(ty0, fold_Ty);
        const layout = this.cx.layout_of(ty);

        const builder = OperandRefBuilder.new<unknown>(layout);
        for (let field_idx = 0; field_idx < fields.length; field_idx++) {
          const field = fields[field_idx]!;
          const op = this.codegen_operand(bx, field);
          const fi = active_field_index ?? (field_idx as FieldIdx);
          builder.insert_field(bx, variant_index, fi, op);
        }

        const tag_result = codegen_tag_value(this.cx, variant_index, layout);
        if (tag_result.$ === "Err") {
          // Like codegen_set_discr we use a sound abort, but could
          // potentially `unreachable` or just return the poison for
          // optimizability, if that turns out to be helpful.
          bx.abort_immediate();
          const val = OperandValue.poison(bx, layout);
          return new OperandRef(val, layout, undefined);
        } else {
          const maybe_tag_value = tag_result._0;
          if (maybe_tag_value !== undefined) {
            const [tag_field, tag_imm] = maybe_tag_value;
            builder.insert_imm(tag_field, tag_imm, bx.debug_Value);
          }
          return builder.build(bx.cx());
        }
      }

      case "WrapUnsafeBinder": {
        const operand = this.codegen_operand(bx, rvalue._0);
        const binder_ty = this.monomorphize(rvalue._1, fold_Ty);
        const layout = bx.cx().layout_of(binder_ty);
        return new OperandRef(operand.val, layout, undefined);
      }

      case "CopyForDeref":
        return bug("`CopyForDeref` in codegen");
    }
  };

  /// Codegen an `Rvalue::RawPtr` or `Rvalue::Ref`
  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:863 codegen_place_to_pointer
  FunctionCx_.prototype.codegen_place_to_pointer = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    place: mir_Place,
    mk_ptr_ty: (tcx: TyCtxt, ty: Ty) => Ty,
  ): OperandRef<unknown> {
    const cg_place = this.codegen_place(bx, place.as_ref());
    const val = cg_place.val.address();

    const ty = cg_place.layout.ty;
    assert(
      bx.cx().tcx_().type_has_metadata(ty, bx.cx().typing_env_()) ? val.$ === "Pair" : val.$ === "Immediate",
      () => `Address of place was unexpectedly ${debug_OperandValue(val, PLAIN, bx.debug_Value)} for pointee type ${debug_Ty(ty, PLAIN)}`,
    );

    return new OperandRef(val, this.cx.layout_of(mk_ptr_ty(this.cx.tcx_(), ty)), undefined);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:889 codegen_scalar_binop
  FunctionCx_.prototype.codegen_scalar_binop = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    op: BinOp,
    lhs: unknown,
    rhs: unknown,
    lhs_ty: Ty,
    rhs_ty: Ty,
  ): unknown {
    const is_float = lhs_ty.is_floating_point();
    const is_signed = lhs_ty.is_signed();
    switch (op) {
      case "Add":
        if (is_float) {
          return bx.fadd(lhs, rhs);
        } else {
          return bx.add(lhs, rhs);
        }
      case "AddUnchecked":
        if (is_signed) {
          return bx.unchecked_sadd(lhs, rhs);
        } else {
          return bx.unchecked_uadd(lhs, rhs);
        }
      case "Sub":
        if (is_float) {
          return bx.fsub(lhs, rhs);
        } else {
          return bx.sub(lhs, rhs);
        }
      case "SubUnchecked":
        if (is_signed) {
          return bx.unchecked_ssub(lhs, rhs);
        } else {
          return bx.unchecked_usub(lhs, rhs);
        }
      case "Mul":
        if (is_float) {
          return bx.fmul(lhs, rhs);
        } else {
          return bx.mul(lhs, rhs);
        }
      case "MulUnchecked":
        if (is_signed) {
          return bx.unchecked_smul(lhs, rhs);
        } else {
          return bx.unchecked_umul(lhs, rhs);
        }
      case "Div":
        if (is_float) {
          return bx.fdiv(lhs, rhs);
        } else if (is_signed) {
          return bx.sdiv(lhs, rhs);
        } else {
          return bx.udiv(lhs, rhs);
        }
      case "Rem":
        if (is_float) {
          return bx.frem(lhs, rhs);
        } else if (is_signed) {
          return bx.srem(lhs, rhs);
        } else {
          return bx.urem(lhs, rhs);
        }
      case "BitOr":
        return bx.or(lhs, rhs);
      case "BitAnd":
        return bx.and(lhs, rhs);
      case "BitXor":
        return bx.xor(lhs, rhs);
      case "Offset": {
        const pointee_type = lhs_ty.builtin_deref(true) ?? bug(`deref of non-pointer ${debug_Ty(lhs_ty, PLAIN)}`);
        const pointee_layout = bx.cx().layout_of(pointee_type);
        if (pointee_layout.is_zst()) {
          // `Offset` works in terms of the size of pointee,
          // so offsetting a pointer to ZST is a noop.
          return lhs;
        } else {
          const llty = bx.cx().backend_type(pointee_layout);
          if (!rhs_ty.is_signed()) {
            return bx.inbounds_nuw_gep(llty, lhs, [rhs]);
          } else {
            return bx.inbounds_gep(llty, lhs, [rhs]);
          }
        }
      }
      case "Shl":
      case "ShlUnchecked": {
        const rhs_ = build_shift_expr_rhs(bx, lhs, rhs, op === "ShlUnchecked");
        return bx.shl(lhs, rhs_);
      }
      case "Shr":
      case "ShrUnchecked": {
        const rhs_ = build_shift_expr_rhs(bx, lhs, rhs, op === "ShrUnchecked");
        if (is_signed) {
          return bx.ashr(lhs, rhs_);
        } else {
          return bx.lshr(lhs, rhs_);
        }
      }
      case "Ne":
      case "Lt":
      case "Gt":
      case "Eq":
      case "Le":
      case "Ge":
        if (is_float) {
          return bx.fcmp(bin_op_to_fcmp_predicate(op), lhs, rhs);
        } else {
          return bx.icmp(bin_op_to_icmp_predicate(op, is_signed), lhs, rhs);
        }
      case "Cmp":
        assert(!is_float, "assertion failed: !is_float");
        return bx.three_way_compare(lhs_ty, lhs, rhs);
      case "AddWithOverflow":
      case "SubWithOverflow":
      case "MulWithOverflow":
        return bug(`${debug_BinOp(op, PLAIN)} needs to return a pair, so call codegen_scalar_checked_binop instead`);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:1014 codegen_wide_ptr_binop
  FunctionCx_.prototype.codegen_wide_ptr_binop = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    op: BinOp,
    lhs_addr: unknown,
    lhs_extra: unknown,
    rhs_addr: unknown,
    rhs_extra: unknown,
    _input_ty: Ty,
  ): unknown {
    switch (op) {
      case "Eq": {
        const lhs = bx.icmp(IntPredicate.IntEQ, lhs_addr, rhs_addr);
        const rhs = bx.icmp(IntPredicate.IntEQ, lhs_extra, rhs_extra);
        return bx.and(lhs, rhs);
      }
      case "Ne": {
        const lhs = bx.icmp(IntPredicate.IntNE, lhs_addr, rhs_addr);
        const rhs = bx.icmp(IntPredicate.IntNE, lhs_extra, rhs_extra);
        return bx.or(lhs, rhs);
      }
      case "Le":
      case "Lt":
      case "Ge":
      case "Gt": {
        // a OP b ~ a.0 STRICT(OP) b.0 | (a.0 == b.0 && a.1 OP a.1)
        let op_: IntPredicate;
        let strict_op: IntPredicate;
        switch (op) {
          case "Lt":
            [op_, strict_op] = [IntPredicate.IntULT, IntPredicate.IntULT];
            break;
          case "Le":
            [op_, strict_op] = [IntPredicate.IntULE, IntPredicate.IntULT];
            break;
          case "Gt":
            [op_, strict_op] = [IntPredicate.IntUGT, IntPredicate.IntUGT];
            break;
          case "Ge":
            [op_, strict_op] = [IntPredicate.IntUGE, IntPredicate.IntUGT];
            break;
        }
        const lhs = bx.icmp(strict_op, lhs_addr, rhs_addr);
        const and_lhs = bx.icmp(IntPredicate.IntEQ, lhs_addr, rhs_addr);
        const and_rhs = bx.icmp(op_, lhs_extra, rhs_extra);
        const rhs = bx.and(and_lhs, and_rhs);
        return bx.or(lhs, rhs);
      }
      default:
        return bug("unexpected wide ptr binop");
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:1056 codegen_scalar_checked_binop
  FunctionCx_.prototype.codegen_scalar_checked_binop = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    op: BinOp,
    lhs: unknown,
    rhs: unknown,
    input_ty: Ty,
  ): OperandValue<unknown> {
    let val;
    let of;
    switch (op) {
      // These are checked using intrinsics
      case "Add":
      case "Sub":
      case "Mul": {
        let oop: OverflowOp;
        switch (op) {
          case "Add":
            oop = OverflowOp.Add;
            break;
          case "Sub":
            oop = OverflowOp.Sub;
            break;
          case "Mul":
            oop = OverflowOp.Mul;
            break;
        }
        [val, of] = bx.checked_binop(oop, input_ty, lhs, rhs);
        break;
      }
      default:
        return bug(`Operator \`${debug_BinOp(op, PLAIN)}\` is not a checkable operator`);
    }

    return { $: "Pair", _0: val, _1: of };
  };
}

// To or from pointers takes different methods, so we use this to restrict
// the SimdVector case to types which can be `bitcast` between each other.
// #[inline]
// rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:368 vector_can_bitcast
function vector_can_bitcast(x: abi_Scalar): boolean {
  return x.$ === "Initialized" && (x.value.$ === "Int" || x.value.$ === "Float");
}

/// Transmutes a single scalar value `imm` from `from_scalar` to `to_scalar`.
///
/// This is expected to be in *immediate* form, as seen in [`OperandValue::Immediate`]
/// or [`OperandValue::Pair`] (so `i1` for bools, not `i8`, for example).
///
/// ICEs if the passed-in `imm` is not a value of the expected type for
/// `from_scalar`, such as if it's a vector or a pair.
// rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:1089 transmute_scalar
export function transmute_scalar<B extends BackendTypes>(bx: BuilderMethods<B>, imm: B["Value"], from_scalar: abi_Scalar, to_scalar: abi_Scalar): B["Value"] {
  assert_eq(abi_Scalar.size(from_scalar, bx.cx()), abi_Scalar.size(to_scalar, bx.cx()), (v) => debug_Size(v, PLAIN), Size_eq);
  const imm_ty = bx.cx().val_ty(imm);
  {
    const left = bx.cx().type_kind(imm_ty);
    if (left === TypeKind.Vector) {
      throw new Panic(
        `assertion \`left != right\` failed: Vector type ${bx.debug_Type(imm_ty, PLAIN)} not allowed in transmute_scalar ${debug_abi_Scalar(from_scalar, PLAIN)} -> ${debug_abi_Scalar(to_scalar, PLAIN)}\n  left: ${debug_TypeKind(left, PLAIN)}\n right: ${debug_TypeKind(TypeKind.Vector, PLAIN)}`,
      );
    }
  }

  // While optimizations will remove no-op transmutes, they might still be
  // there in debug or things that aren't no-op in MIR because they change
  // the Rust type but not the underlying layout/niche.
  if (abi_Scalar_eq(from_scalar, to_scalar)) {
    return imm;
  }

  // use abi::Primitive::*;
  imm = bx.from_immediate(imm);

  const from_backend_ty = bx.cx().type_from_scalar(from_scalar);
  // debug_assert_eq!(bx.cx().val_ty(imm), from_backend_ty);
  const to_backend_ty = bx.cx().type_from_scalar(to_scalar);

  // If we have a scalar, we must already know its range. Either
  //
  // 1) It's a parameter with `range` parameter metadata,
  // 2) It's something we `load`ed with `!range` metadata, or
  // 3) After a transmute we `assume`d the range (see below).
  //
  // That said, last time we tried removing this, it didn't actually help
  // the rustc-perf results, so might as well keep doing it
  // <https://github.com/rust-lang/rust/pull/135610#issuecomment-2599275182>
  assume_scalar_range(bx, imm, from_scalar, from_backend_ty, to_scalar);

  const from = abi_Scalar.primitive(from_scalar);
  const to = abi_Scalar.primitive(to_scalar);
  if ((from.$ === "Int" || from.$ === "Float") && (to.$ === "Int" || to.$ === "Float")) {
    imm = bx.bitcast(imm, to_backend_ty);
  } else if (from.$ === "Pointer" && to.$ === "Pointer") {
    imm = bx.pointercast(imm, to_backend_ty);
  } else if (from.$ === "Int" && to.$ === "Pointer") {
    imm = bx.inttoptr(imm, to_backend_ty);
  } else if (from.$ === "Pointer" && to.$ === "Int") {
    // FIXME: this exposes the provenance, which shouldn't be necessary.
    imm = bx.ptrtoint(imm, to_backend_ty);
  } else if (from.$ === "Float" && to.$ === "Pointer") {
    const int_imm = bx.bitcast(imm, bx.cx().type_isize());
    imm = bx.inttoptr(int_imm, to_backend_ty);
  } else {
    // (Pointer(..), Float(_))
    // FIXME: this exposes the provenance, which shouldn't be necessary.
    const int_imm = bx.ptrtoint(imm, bx.cx().type_isize());
    imm = bx.bitcast(int_imm, to_backend_ty);
  }

  // debug_assert_eq!(bx.cx().val_ty(imm), to_backend_ty);

  // This `assume` remains important for cases like (a conceptual)
  //    transmute::<u32, NonZeroU32>(x) == 0
  // since it's never passed to something with parameter metadata (especially
  // after MIR inlining) so the only way to tell the backend about the
  // constraint that the `transmute` introduced is to `assume` it.
  assume_scalar_range(bx, imm, to_scalar, to_backend_ty, from_scalar);

  imm = bx.to_immediate_scalar(imm, to_scalar);
  return imm;
}

/// Emits an `assume` call that `imm`'s value is within the known range of `scalar`.
///
/// If `known` is `Some`, only emits the assume if it's more specific than
/// whatever is already known from the range of *that* scalar.
// rustc: compiler/rustc_codegen_ssa/src/mir/rvalue.rs:1164 assume_scalar_range
function assume_scalar_range<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  imm: B["Value"],
  scalar: abi_Scalar,
  backend_ty: B["Type"],
  known: abi_Scalar | undefined,
): void {
  if (bx.cx().sess().opts.optimize === "No") {
    return;
  }

  if (scalar.$ === "Union") {
    return;
  } else if (known === undefined) {
    if (abi_Scalar.is_always_valid(scalar, bx.cx())) {
      return;
    }
  } else {
    const valid_range = scalar.valid_range;
    const known_range = abi_Scalar.valid_range(known, bx.cx());
    if (valid_range.contains_range(known_range, abi_Scalar.size(scalar, bx.cx()))) {
      return;
    }
  }

  const p = abi_Scalar.primitive(scalar);
  if (p.$ === "Int") {
    const range = abi_Scalar.valid_range(scalar, bx.cx());
    bx.assume_integer_range(imm, backend_ty, range);
  } else if (p.$ === "Pointer" && p._0 === AddressSpace.ZERO && !abi_Scalar.valid_range(scalar, bx.cx()).contains(0n)) {
    bx.assume_nonnull(imm);
  } else {
    // abi::Primitive::Pointer(..) | abi::Primitive::Float(..) => {}
  }
}

// ---- Local helpers (not upstream) ------------------------------------------------------------------------------------

/** `Ord::max` on `Align` (derived `Ord` compares `pow2`); equal values are identical, so either is returned. */
function Align_max(a: Align, b: Align): Align {
  return b.pow2 >= a.pow2 ? b : a;
}

/** `Ord::max` on `Size` (`Ord::max` returns the second argument when equal). */
function Size_max(a: Size, b: Size): Size {
  return Size_cmp(a, b) === 1 ? a : b;
}

/** `u128::to_le_bytes`. */
function u128_to_le_bytes(v: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) out.push(Number((v >> BigInt(i * 8)) & 0xffn));
  return out;
}

/** `Itertools::all_equal_value` (itertools 0.15.0): `Ok(first)` when the iterator is non-empty and all items are equal,
 *  else `Err(..)` (here `undefined`). */
function all_equal_value(bytes: readonly number[]): number | undefined {
  if (bytes.length === 0) return undefined;
  const first = bytes[0]!;
  for (const b of bytes) if (b !== first) return undefined;
  return first;
}

