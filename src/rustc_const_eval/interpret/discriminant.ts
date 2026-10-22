// Port of compiler/rustc_const_eval/src/interpret/discriminant.rs (declared by lane interp-contract, filled by lane interp-ops).
//! Functions for reading and writing discriminants of multi-variant layouts (enums and coroutines).
import { BackendRepr, type FieldIdx, Scalar as abi_Scalar, debug_Size, VariantIdx } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type Writeable } from "./place.ts";
import { type Projectable } from "./projection.ts";
import {
  type AllocId,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  InterpResult,
  interp_ok,
  Scalar,
  Scalar_from_ScalarInt,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { BinOp } from "../../rustc_middle/mir/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { PrimitiveExt, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { CoroutineArgsExt } from "../../rustc_middle/ty/sty.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { ImmTy } from "./operand.gen.ts";
import { Immediate } from "./operand.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // discriminant.rs:20 (lane interp-ops)
    write_discriminant(variant_index: VariantIdx, dest: Writeable): InterpResult;
    // discriminant.rs:53 (lane interp-ops)
    read_discriminant(op: Projectable): InterpResult<VariantIdx>;
    // discriminant.rs:222 (lane interp-ops)
    discriminant_for_variant(ty: Ty, variant: VariantIdx): InterpResult<ImmTy>;
    // discriminant.rs:247 (lane interp-ops)
    tag_for_variant(layout: TyAndLayout, variant_index: VariantIdx): InterpResult<[ScalarInt, FieldIdx] | undefined>;
  }
}

/** PORT: an `&impl Projectable` / `&impl Writeable` parameter passed on to a generic `P: Projectable` fn (`P` = the
 * value's own type). */
interface AnyProjectable extends Projectable<AnyProjectable> {}
interface AnyWriteable extends Writeable<AnyWriteable> {}

/** `throw_ub!(..)` / `err_ub!(..)` of this file. */
function ub<T>(info: Extract<InterpErrorKind, { $: "UndefinedBehavior" }>["_0"]): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: info }));
}

/// Writes the discriminant of the given variant.
///
/// If the variant is uninhabited, this is UB.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/discriminant.rs:20 write_discriminant
InterpCx.prototype.write_discriminant = function (this: InterpCx, variant_index: VariantIdx, dest: Writeable): InterpResult {
  const r = this.tag_for_variant(dest.layout_(), variant_index);
  if (r.$ === "Err") return r;
  if (r._0 !== undefined) {
    const [tag, tag_field] = r._0;
    // No need to validate that the discriminant here because the
    // `TyAndLayout::for_variant()` call earlier already checks the
    // variant is valid.
    const tag_dest = this.project_field(dest as AnyWriteable, tag_field);
    if (tag_dest.$ === "Err") return tag_dest;
    return this.write_scalar(Scalar_from_ScalarInt(tag), tag_dest._0);
  } else {
    // No need to write the tag here, because an untagged variant is
    // implicitly encoded. For `Niche`-optimized enums, this works by
    // simply by having a value that is outside the niche variants.
    // But what if the data stored here does not actually encode
    // this variant? That would be bad! So let's double-check...
    const op = dest.to_op(this);
    if (op.$ === "Err") return op;
    const actual_variant = this.read_discriminant(op._0);
    if (actual_variant.$ === "Err") return actual_variant;
    if (actual_variant._0 !== variant_index) {
      // throw_ub!(InvalidNichedEnumVariantWritten { enum_ty: dest.layout().ty })
      return ub({ $: "InvalidNichedEnumVariantWritten", enum_ty: dest.layout_().ty });
    }
    return interp_ok(undefined);
  }
};

/// Read discriminant, return the variant index.
/// Can also legally be called on non-enums (e.g. through the discriminant_value intrinsic)!
///
/// Will never return an uninhabited variant.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/discriminant.rs:53 read_discriminant
InterpCx.prototype.read_discriminant = function (this: InterpCx, op: Projectable): InterpResult<VariantIdx> {
  const ty = op.layout_().ty;
  // trace!("read_discriminant_value {:#?}", op.layout());
  // Get type and layout of the discriminant.
  const discr_layout_r = this.layout_of(ty.discriminant_ty(this.tcx.deref()));
  if (discr_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(discr_layout_r._0));
  const discr_layout = discr_layout_r._0;
  // trace!("discriminant type: {:?}", discr_layout.ty);

  // We use "discriminant" to refer to the value associated with a particular enum variant.
  // This is not to be confused with its "variant index", which is just determining its position in the
  // declared list of variants -- they can differ with explicitly assigned discriminants.
  // We use "tag" to refer to how the discriminant is encoded in memory, which can be either
  // straight-forward (`TagEncoding::Direct`) or with a niche (`TagEncoding::Niche`).
  const variants = op.layout_().variants;
  switch (variants.$) {
    case "Empty":
      // throw_ub!(UninhabitedEnumVariantRead(None))
      return ub({ $: "UninhabitedEnumVariantRead", _0: undefined });
    case "Single": {
      const index = variants.index;
      if (op.layout_().is_uninhabited()) {
        // For consistency with `write_discriminant`, and to make sure that
        // `project_downcast` cannot fail due to strange layouts, we declare immediate UB
        // for uninhabited enums.
        // throw_ub!(UninhabitedEnumVariantRead(Some(index)))
        return ub({ $: "UninhabitedEnumVariantRead", _0: index });
      }
      // Since the type is inhabited, there must be an index.
      return interp_ok(index);
    }
    case "Multiple":
      break;
  }
  const tag_scalar_layout = variants.tag;
  const tag_encoding = variants.tag_encoding;
  const tag_field = variants.tag_field;

  // There are *three* layouts that come into play here:
  // - The discriminant has a type for typechecking. This is `discr_layout`, and is used for
  //   the `Scalar` we return.
  // - The tag (encoded discriminant) has layout `tag_layout`. This is always an integer type,
  //   and used to interpret the value we read from the tag field.
  //   For the return value, a cast to `discr_layout` is performed.
  // - The field storing the tag has a layout, which is very similar to `tag_layout` but
  //   may be a pointer. This is `tag_val.layout`; we just use it for sanity checks.

  // Get layout for tag.
  const tag_layout_r = this.layout_of(PrimitiveExt.to_int_ty(abi_Scalar.primitive(tag_scalar_layout), this.tcx.deref()));
  if (tag_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(tag_layout_r._0));
  const tag_layout = tag_layout_r._0;

  // Read tag and sanity-check `tag_layout`.
  const tag_place = this.project_field(op as AnyProjectable, tag_field);
  if (tag_place.$ === "Err") return tag_place;
  const tag_val_r = this.read_immediate(tag_place._0);
  if (tag_val_r.$ === "Err") return tag_val_r;
  const tag_val = tag_val_r._0;
  assert_eq(tag_layout.size, tag_val.layout.size, (v) => debug_Size(v, PLAIN), (a, b) => a.bytes() === b.bytes());
  assert_eq(BackendRepr.is_signed(tag_layout.backend_repr), BackendRepr.is_signed(tag_val.layout.backend_repr), (v) => `${v}`);
  // trace!("tag value: {}", tag_val);

  // Figure out which discriminant and variant this corresponds to.
  let index: VariantIdx;
  switch (tag_encoding.$) {
    case "Direct": {
      // Generate a specific error if `tag_val` is not an integer.
      // (`tag_bits` itself is only used for error messages below.)
      const tag_int = Scalar.try_to_scalar_int(Immediate.to_scalar(tag_val.imm));
      if (tag_int.$ === "Err") {
        // err_ub!(InvalidTag(dbg_val))
        return ub({ $: "InvalidTag", _0: tag_int._0 });
      }
      const tag_bits = tag_int._0.to_bits(tag_layout.size);
      // Ensure the tag is in its layout range. Codegen adds range metadata on the
      // discriminant load so we really have to make this UB.
      if (!abi_Scalar.valid_range(tag_scalar_layout, this).contains(tag_bits)) {
        // throw_ub!(InvalidTag(Scalar::from_uint(tag_bits, tag_layout.size)))
        return ub({ $: "InvalidTag", _0: Scalar.from_uint<AllocId>(tag_bits, tag_layout.size) });
      }
      // Cast bits from tag layout to discriminant layout.
      // After the checks we did above, this cannot fail, as
      // discriminants are int-like.
      const discr_val = InterpResult.unwrap(this.int_to_int_or_float(tag_val, discr_layout));
      const discr_bits_r = Scalar.to_bits(Immediate.to_scalar(discr_val.imm), discr_layout.size);
      if (discr_bits_r.$ === "Err") return discr_bits_r;
      const discr_bits = discr_bits_r._0;
      // Convert discriminant to variant index. The tag may pass the layout range
      // check above but still not match any actual variant discriminant (e.g.,
      // non-contiguous discriminants with a wrapping valid_range).
      let found: VariantIdx | undefined;
      const kind = ty.kind();
      switch (kind.$) {
        case "Adt": {
          for (const [idx, var_] of kind._0.discriminants(this.tcx.deref())) {
            if (var_.val === discr_bits) {
              found = idx;
              break;
            }
          }
          break;
        }
        case "Coroutine": {
          const def_id = kind._0;
          const args = kind._1.as_coroutine();
          for (const [idx, var_] of CoroutineArgsExt.discriminants(args, def_id, this.tcx.deref())) {
            if (var_.val === discr_bits) {
              found = idx;
              break;
            }
          }
          break;
        }
        default:
          return span_bug(this.cur_span(), "tagged layout for non-adt non-coroutine");
      }
      if (found === undefined) {
        // err_ub!(InvalidTag(Scalar::from_uint(tag_bits, tag_layout.size)))
        return ub({ $: "InvalidTag", _0: Scalar.from_uint<AllocId>(tag_bits, tag_layout.size) });
      }
      // Return the cast value, and the index.
      index = found;
      break;
    }
    case "Niche": {
      const untagged_variant = tag_encoding.untagged_variant;
      const niche_variants = tag_encoding.niche_variants;
      const niche_start = tag_encoding.niche_start;
      const tag_val_s = Immediate.to_scalar(tag_val.imm);
      // Compute the variant this niche value/"tag" corresponds to. With niche layout,
      // discriminant (encoded in niche/tag) and variant index are the same.
      const variants_start = VariantIdx.as_u32(niche_variants.start);
      const variants_last = VariantIdx.as_u32(niche_variants.last);
      let variant: VariantIdx;
      const tag_int = Scalar.try_to_scalar_int(tag_val_s);
      if (tag_int.$ === "Err") {
        const dbg_val = tag_int._0;
        // So this is a pointer then, and casting to an int failed.
        // Can only happen during CTFE.
        // The niche must be just 0, and the ptr not null, then we know this is
        // okay. Everything else, we conservatively reject.
        let ptr_valid = niche_start === 0n && variants_start === variants_last;
        if (ptr_valid) {
          const may_be_null = this.scalar_may_be_null(tag_val_s);
          if (may_be_null.$ === "Err") return may_be_null;
          ptr_valid = !may_be_null._0;
        }
        if (!ptr_valid) {
          // throw_ub!(InvalidTag(dbg_val))
          return ub({ $: "InvalidTag", _0: dbg_val });
        }
        variant = untagged_variant;
      } else {
        const tag_bits = tag_int._0.to_bits(tag_layout.size);
        // We need to use machine arithmetic to get the relative variant idx:
        // variant_index_relative = tag_val - niche_start_val
        const tag_val = ImmTy.from_uint(tag_bits, tag_layout);
        const niche_start_val = ImmTy.from_uint(niche_start, tag_layout);
        const variant_index_relative_val = this.binary_op(BinOp.Sub, tag_val, niche_start_val);
        if (variant_index_relative_val.$ === "Err") return variant_index_relative_val;
        const variant_index_relative_r = Scalar.to_bits(Immediate.to_scalar(variant_index_relative_val._0.imm), tag_val.layout.size);
        if (variant_index_relative_r.$ === "Err") return variant_index_relative_r;
        const variant_index_relative_bits = variant_index_relative_r._0;
        // Check if this is in the range that indicates an actual discriminant.
        if (variant_index_relative_bits <= BigInt(variants_last - variants_start)) {
          // `u32::try_from(variant_index_relative).expect("we checked that this fits into a u32")`
          if (variant_index_relative_bits > 0xffff_ffffn) {
            panic("we checked that this fits into a u32: TryFromIntError(())");
          }
          const variant_index_relative = Number(variant_index_relative_bits);
          // Then computing the absolute variant idx should not overflow any more.
          // `variants_start.checked_add(variant_index_relative).expect(..)`
          const sum = variants_start + variant_index_relative;
          if (sum > 0xffff_ffff) {
            panic("overflow computing absolute variant idx");
          }
          const variant_index = VariantIdx.from_u32(sum);
          const variants = unwrap(ty.ty_adt_def(), "tagged layout for non adt").variants();
          assert(variant_index < variants.length, "assertion failed: variant_index < variants.next_index()");
          // This should imply that the tag is in its layout range.
          assert(abi_Scalar.valid_range(tag_scalar_layout, this).contains(tag_bits), "assertion failed: tag_scalar_layout.valid_range(self).contains(tag_bits)");

          if (variant_index === untagged_variant) {
            // The untagged variant can be in the niche range, but even then it
            // is not a valid encoding. Codegen inserts an `assume` here
            // so we really have to make this UB.
            // throw_ub!(InvalidTag(Scalar::from_uint(tag_bits, tag_layout.size)))
            return ub({ $: "InvalidTag", _0: Scalar.from_uint<AllocId>(tag_bits, tag_layout.size) });
          }
          variant = variant_index;
        } else {
          // Ensure the tag is in its layout range. Codegen adds range metadata on
          // the discriminant load so we really have to make this UB.
          if (!abi_Scalar.valid_range(tag_scalar_layout, this).contains(tag_bits)) {
            // throw_ub!(InvalidTag(Scalar::from_uint(tag_bits, tag_layout.size)))
            return ub({ $: "InvalidTag", _0: Scalar.from_uint<AllocId>(tag_bits, tag_layout.size) });
          }
          variant = untagged_variant;
        }
      }
      // Compute the size of the scalar we need to return.
      // No need to cast, because the variant index directly serves as discriminant and is
      // encoded in the tag.
      index = variant;
      break;
    }
  }
  // Reading the discriminant of an uninhabited variant is UB. This is the basis for the
  // `uninhabited_enum_branching` MIR pass. It also ensures consistency with
  // `write_discriminant`.
  if (op.layout_().is_variant_uninhabited(index)) {
    // throw_ub!(UninhabitedEnumVariantRead(Some(index)))
    return ub({ $: "UninhabitedEnumVariantRead", _0: index });
  }
  return interp_ok(index);
};

/// Read discriminant, return the user-visible discriminant.
/// Can also legally be called on non-enums (e.g. through the discriminant_value intrinsic)!
// rustc: compiler/rustc_const_eval/src/interpret/discriminant.rs:222 discriminant_for_variant
InterpCx.prototype.discriminant_for_variant = function (this: InterpCx, ty: Ty, variant: VariantIdx): InterpResult<ImmTy> {
  const discr_layout_r = this.layout_of(ty.discriminant_ty(this.tcx.deref()));
  if (discr_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(discr_layout_r._0));
  const discr_layout = discr_layout_r._0;
  let discr_value: Scalar;
  const discr = ty.discriminant_for_variant(this.tcx.deref(), variant);
  if (discr !== undefined) {
    // This type actually has discriminants.
    assert_eq(discr.ty, discr_layout.ty, (v) => debug_Ty(v, PLAIN));
    discr_value = Scalar.from_uint(discr.val, discr_layout.size);
  } else {
    // On a type without actual discriminants, variant is 0.
    assert_eq(VariantIdx.as_u32(variant), 0, (v) => `${v}`);
    discr_value = Scalar.from_uint(BigInt(VariantIdx.as_u32(variant)), discr_layout.size);
  }
  return interp_ok(ImmTy.from_scalar(discr_value, discr_layout));
};

/// Computes how to write the tag of a given variant of enum `ty`:
/// - `None` means that nothing needs to be done as the variant is encoded implicitly
/// - `Some((val, field_idx))` means that the given integer value needs to be stored at the
///   given field index.
// rustc: compiler/rustc_const_eval/src/interpret/discriminant.rs:247 tag_for_variant
InterpCx.prototype.tag_for_variant = function (this: InterpCx, layout: TyAndLayout, variant_index: VariantIdx): InterpResult<[ScalarInt, FieldIdx] | undefined> {
  // Layout computation excludes uninhabited variants from consideration.
  // Therefore, there's no way to represent those variants in the given layout.
  // Essentially, uninhabited variants do not have a tag that corresponds to their
  // discriminant, so we have to bail out here.
  if (layout.is_variant_uninhabited(variant_index)) {
    // throw_ub!(UninhabitedEnumVariantWritten(variant_index))
    return ub({ $: "UninhabitedEnumVariantWritten", _0: variant_index });
  }

  const variants = layout.variants;
  switch (variants.$) {
    case "Empty":
      return unreachable("internal error: entered unreachable code: we already handled uninhabited types");
    case "Single":
      // The tag of a `Single` enum is like the tag of the niched
      // variant: there's no tag as the discriminant is encoded
      // entirely implicitly. If `write_discriminant` ever hits this
      // case, we do a "validation read" to ensure the right
      // discriminant is encoded implicitly, so any attempt to write
      // the wrong discriminant for a `Single` enum will reliably
      // result in UB.
      return interp_ok(undefined);
    case "Multiple":
      break;
  }

  const tag_encoding = variants.tag_encoding;
  if (tag_encoding.$ === "Direct") {
    const tag_layout = variants.tag;
    const tag_field = variants.tag_field;
    // raw discriminants for enums are isize or bigger during
    // their computation, but the in-memory tag is the smallest possible
    // representation
    const discr = this.discriminant_for_variant(layout.ty, variant_index);
    if (discr.$ === "Err") return discr;
    const discr_size = discr._0.layout.size;
    const discr_val = Scalar.to_bits(Immediate.to_scalar(discr._0.imm), discr_size);
    if (discr_val.$ === "Err") return discr_val;
    const tag_size = abi_Scalar.size(tag_layout, this);
    const tag_val = tag_size.truncate(discr_val._0);
    const tag = unwrap(ScalarInt.try_from_uint(tag_val, tag_size));
    return interp_ok<[ScalarInt, FieldIdx] | undefined>([tag, tag_field]);
  }

  if (tag_encoding.untagged_variant === variant_index) {
    // The untagged variant is implicitly encoded simply by having a
    // value that is outside the niche variants.
    return interp_ok(undefined);
  }

  {
    const untagged_variant = tag_encoding.untagged_variant;
    const niche_variants = tag_encoding.niche_variants;
    const niche_start = tag_encoding.niche_start;
    const tag_layout_s = variants.tag;
    const tag_field = variants.tag_field;
    assert(variant_index !== untagged_variant, "assertion failed: variant_index != untagged_variant");
    // We checked that this variant is inhabited, so it must be in the niche range.
    assert(niche_variants.start <= variant_index && variant_index <= niche_variants.last, "invalid variant index for this enum");
    const variants_start = VariantIdx.as_u32(niche_variants.start);
    // `variant_index.as_u32().strict_sub(variants_start)`
    const variant_index_relative = VariantIdx.as_u32(variant_index) - variants_start;
    if (variant_index_relative < 0) panic("attempt to subtract with overflow");
    // We need to use machine arithmetic when taking into account `niche_start`:
    // tag_val = variant_index_relative + niche_start_val
    const tag_layout_r = this.layout_of(PrimitiveExt.to_int_ty(abi_Scalar.primitive(tag_layout_s), this.tcx.deref()));
    if (tag_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(tag_layout_r._0));
    const tag_layout = tag_layout_r._0;
    const niche_start_val = ImmTy.from_uint(niche_start, tag_layout);
    const variant_index_relative_val = ImmTy.from_uint(BigInt(variant_index_relative), tag_layout);
    const sum = this.binary_op(BinOp.Add, variant_index_relative_val, niche_start_val);
    if (sum.$ === "Err") return sum;
    const tag = sum._0.to_scalar_int();
    if (tag.$ === "Err") return tag;
    return interp_ok<[ScalarInt, FieldIdx] | undefined>([tag._0, tag_field]);
  }
};
