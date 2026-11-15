// Port of compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs (lane cg-di-b, plan-m7 wave 40s).
//
// PORT (cg-di-b):
// - `impl Iterator<Item = (Cow<str>, u128)>` arguments are `Iterable`s, consumed where upstream consumes them: lazy
//   generators where upstream passes a lazy `map` (`enum_adt_def.discriminants(..)`, cpp_like's variant names), so their
//   queries run in upstream's order.
// - `Cow<str>` is a `string`; `SmallVec` an array; `IndexSlice<FieldIdx, Symbol>` a `readonly Symbol[]`.
// - `#[derive(Copy, Clone)] enum DiscrResult` is a `$`-tagged union; `opt_single_val` lives on its companion const.
// - `u128` values are `bigint`; `value as u64` is `BigInt.asUintN(64, ..)`; `wrapping_sub`/`wrapping_add` on `u128` wrap
//   with `BigInt.asUintN(128, ..)`.
import { FieldsShape, Scalar, type Size } from "../../../../rustc_abi/lib.ts";
import { FieldIdx, type VariantIdx } from "../../../../rustc_abi/layout.ts";
import { tag_base_type, wants_c_like_enum_debuginfo } from "../../../../rustc_codegen_ssa/debuginfo/mod.ts";
import { compute_debuginfo_type_name, cpp_like_debuginfo } from "../../../../rustc_codegen_ssa/debuginfo/type_names.ts";
import type { CoroutineLayout } from "../../../../rustc_middle/mir/query.gen.ts";
import type { AdtDef } from "../../../../rustc_middle/ty/adt.ts";
import type { TyAndLayout } from "../../../../rustc_middle/ty/layout.ts";
import type { Ty, VariantDef } from "../../../../rustc_middle/ty/mod.ts";
import { CoroutineArgsExt } from "../../../../rustc_middle/ty/sty.ts";
import { debug_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../../rustc_span/def_id.ts";
import type { Span } from "../../../../rustc_span/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { CoroutineArgs } from "../../../../rustc_type_ir/ty_kind/closure.ts";
import { PLAIN } from "../../../../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../../../../std/panic.ts";
import { utf8_len } from "../../../../std/str.ts";
import type { CodegenCx } from "../../../context.ts";
import * as llvm from "../../../llvm/mod.ts";
import type { DIFlags, DIType } from "../../../llvm/mod.ts";
import { create_DIArray, DIB, get_namespace_for_item } from "../../utils.ts";
import {
  build_field_di_node,
  build_generic_type_param_di_nodes,
  file_metadata_from_def_id,
  size_and_align_of,
  tuple_field_name,
  type_di_node,
  UNKNOWN_LINE_NUMBER,
  unknown_file_metadata,
} from "../../metadata.ts";
import { DINodeCreationResult, Stub, UniqueTypeId } from "../type_map.ts";
import * as type_map from "../type_map.ts";
import * as cpp_like from "./cpp_like.ts";
import * as native from "./native.ts";

// mod cpp_like;
// mod native;

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:29 build_enum_type_di_node
export function build_enum_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId, span: Span): DINodeCreationResult {
  const enum_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = enum_type.kind();
  if (k.$ !== "Adt") {
    return bug(`build_enum_type_di_node() called with non-enum type: \`${debug_Ty(enum_type, PLAIN)}\``);
  }
  const enum_adt_def = k._0;

  const enum_type_and_layout = cx.spanned_layout_of(enum_type, span);

  if (wants_c_like_enum_debuginfo(cx.tcx, enum_type_and_layout)) {
    return build_c_style_enum_di_node(cx, enum_adt_def, enum_type_and_layout);
  }

  if (cpp_like_debuginfo(cx.tcx)) {
    return cpp_like.build_enum_type_di_node(cx, unique_type_id);
  } else {
    return native.build_enum_type_di_node(cx, unique_type_id);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:52 build_coroutine_di_node
export function build_coroutine_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  if (cpp_like_debuginfo(cx.tcx)) {
    return cpp_like.build_coroutine_di_node(cx, unique_type_id);
  } else {
    return native.build_coroutine_di_node(cx, unique_type_id);
  }
}

/// Build the debuginfo node for a C-style enum, i.e. an enum the variants of which have no fields.
///
/// The resulting debuginfo will be a DW_TAG_enumeration_type.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:66 build_c_style_enum_di_node
function build_c_style_enum_di_node(cx: CodegenCx, enum_adt_def: AdtDef, enum_type_and_layout: TyAndLayout): DINodeCreationResult {
  const containing_scope = get_namespace_for_item(cx, enum_adt_def.did());
  const enum_adt_def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? enum_adt_def.did() : undefined;
  return new DINodeCreationResult(
    build_enumeration_type_di_node(
      cx,
      compute_debuginfo_type_name(cx.tcx, enum_type_and_layout.ty, false),
      tag_base_type(cx.tcx, enum_type_and_layout),
      (function* (): Generator<[string, bigint]> {
        for (const [variant_index, discr] of enum_adt_def.discriminants(cx.tcx)) {
          const name = Symbol.as_str(enum_adt_def.variant(variant_index).name);
          yield [name, discr.val];
        }
      })(),
      enum_adt_def_id,
      containing_scope,
    ),
    false,
  );
}

/// Build a DW_TAG_enumeration_type debuginfo node, with the given base type and variants.
/// This is a helper function and does not register anything in the type map by itself.
///
/// `variants` is an iterator of (discr-value, variant-name).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:97 build_enumeration_type_di_node
export function build_enumeration_type_di_node(
  cx: CodegenCx,
  type_name: string,
  base_type: Ty,
  enumerators: Iterable<readonly [string, bigint]>,
  def_id: DefId | undefined,
  containing_scope: DIType,
): DIType {
  let is_unsigned: boolean;
  switch (base_type.kind().$) {
    case "Int":
      is_unsigned = false;
      break;
    case "Uint":
      is_unsigned = true;
      break;
    default:
      return bug("build_enumeration_type_di_node() called with non-integer tag type.");
  }
  const [size, align] = cx.size_and_align_of(base_type);

  const enumerator_di_nodes: (DIType | undefined)[] = [];
  for (const [name, value] of enumerators) {
    const value_words = [BigInt.asUintN(64, value), BigInt.asUintN(64, value >> 64n)];
    const size_in_bits = BigInt(size.bits());
    // LLVM computes `NumWords = (SizeInBits + 63) / 64`.
    assert((size_in_bits + 63n) / 64n <= BigInt(value_words.length), "assertion failed: (size_in_bits + 63) / 64 <= value_words.len() as u64");

    const enumerator = llvm.LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision(DIB(cx), name, utf8_len(name), size_in_bits, value_words, llvm.to_llvm_bool(is_unsigned));
    enumerator_di_nodes.push(enumerator);
  }

  let file_metadata: DIType;
  let line_number: number;
  if (cx.sess().opts.unstable_opts.debug_info_type_line_numbers) {
    [file_metadata, line_number] = file_metadata_from_def_id(cx, def_id);
  } else {
    [file_metadata, line_number] = [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }

  return llvm.LLVMRustDIBuilderCreateEnumerationType(
    DIB(cx),
    containing_scope,
    type_name,
    utf8_len(type_name),
    file_metadata,
    line_number,
    BigInt(size.bits()),
    align.bits() >>> 0,
    create_DIArray(DIB(cx), enumerator_di_nodes),
    type_di_node(cx, base_type),
    true,
  );
}

/// Build the debuginfo node for the struct type describing a single variant of an enum.
///
/// ```txt
///       DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///  --->   DW_TAG_structure_type            (type of variant 1)
///  --->   DW_TAG_structure_type            (type of variant 2)
///  --->   DW_TAG_structure_type            (type of variant 3)
/// ```
///
/// In CPP-like mode, we have the exact same descriptions for each variant too:
///
/// ```txt
///       DW_TAG_union_type              (top-level type for enum)
///         DW_TAG_member                    (member for variant 1)
///         DW_TAG_member                    (member for variant 2)
///         DW_TAG_member                    (member for variant 3)
///  --->   DW_TAG_structure_type            (type of variant 1)
///  --->   DW_TAG_structure_type            (type of variant 2)
///  --->   DW_TAG_structure_type            (type of variant 3)
///         DW_TAG_enumeration_type          (type of tag)
/// ```
///
/// The node looks like:
///
/// ```txt
/// DW_TAG_structure_type
///   DW_AT_name                  <name-of-variant>
///   DW_AT_byte_size             0x00000010
///   DW_AT_alignment             0x00000008
///   DW_TAG_member
///     DW_AT_name                  <name-of-field-0>
///     DW_AT_type                  <0x0000018e>
///     DW_AT_alignment             0x00000004
///     DW_AT_data_member_location  4
///   DW_TAG_member
///     DW_AT_name                  <name-of-field-1>
///     DW_AT_type                  <0x00000195>
///     DW_AT_alignment             0x00000008
///     DW_AT_data_member_location  8
///   ...
/// ```
///
/// The type of a variant is always a struct type with the name of the variant
/// and a DW_TAG_member for each field (but not the discriminant).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:207 build_enum_variant_struct_type_di_node
export function build_enum_variant_struct_type_di_node(
  cx: CodegenCx,
  enum_type_and_layout: TyAndLayout,
  enum_type_di_node: DIType,
  variant_index: VariantIdx,
  variant_def: VariantDef,
  variant_layout: TyAndLayout,
  di_flags: DIFlags,
): DIType {
  if (variant_layout.ty !== enum_type_and_layout.ty) {
    panic(`assertion \`left == right\` failed\n  left: ${debug_Ty(variant_layout.ty, PLAIN)}\n right: ${debug_Ty(enum_type_and_layout.ty, PLAIN)}`);
  }

  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, variant_def.def_id) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Struct,
      UniqueTypeId.for_enum_variant_struct_type(cx.tcx, enum_type_and_layout.ty, variant_index),
      Symbol.as_str(variant_def.name),
      def_location,
      // NOTE: We use size and align of enum_type, not from variant_layout:
      size_and_align_of(enum_type_and_layout),
      enum_type_di_node,
      di_flags,
    ),
    (cx, struct_type_di_node) => {
      const out: DIType[] = [];
      const count = FieldsShape.count(variant_layout.fields);
      for (let field_index = 0; field_index < count; field_index++) {
        let field_name: string;
        if (variant_def.ctor_kind() !== "Fn") {
          // Fields have names
          const field = variant_def.fields[FieldIdx.from_usize(field_index)]!;
          field_name = Symbol.as_str(field.name);
        } else {
          // Tuple-like
          field_name = tuple_field_name(field_index);
        }

        const field_layout = variant_layout.field(cx, field_index);

        out.push(
          build_field_di_node(
            cx,
            struct_type_di_node,
            field_name,
            field_layout,
            FieldsShape.offset(variant_layout.fields, field_index),
            di_flags,
            type_di_node(cx, field_layout.ty),
            undefined,
          ),
        );
      }
      return out;
    },
    (cx) => build_generic_type_param_di_nodes(cx, enum_type_and_layout.ty),
  ).di_node;
}

/// Build the struct type for describing a single coroutine state.
/// See [build_coroutine_variant_struct_type_di_node].
///
/// ```txt
///
///       DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///  --->   DW_TAG_structure_type            (type of variant 1)
///  --->   DW_TAG_structure_type            (type of variant 2)
///  --->   DW_TAG_structure_type            (type of variant 3)
///
/// ```
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:290 build_coroutine_variant_struct_type_di_node
export function build_coroutine_variant_struct_type_di_node(
  cx: CodegenCx,
  variant_index: VariantIdx,
  coroutine_type_and_layout: TyAndLayout,
  coroutine_type_di_node: DIType,
  coroutine_layout: CoroutineLayout,
  common_upvar_names: readonly Symbol[],
): DIType {
  const variant_name = CoroutineArgsExt.variant_name(variant_index);
  const unique_type_id = UniqueTypeId.for_enum_variant_struct_type(cx.tcx, coroutine_type_and_layout.ty, variant_index);

  const variant_layout = coroutine_type_and_layout.for_variant(cx, variant_index);

  const ck = coroutine_type_and_layout.ty.kind();
  let coroutine_args;
  switch (ck.$) {
    case "Coroutine":
      coroutine_args = ck._1.as_coroutine();
      break;
    default:
      return unreachable();
  }

  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, unique_type_id, variant_name, undefined, size_and_align_of(coroutine_type_and_layout), coroutine_type_di_node, llvm.DIFlags.FlagZero),
    (cx, variant_struct_type_di_node) => {
      // Fields that just belong to this variant/state
      const state_specific_fields: DIType[] = [];
      const count = FieldsShape.count(variant_layout.fields);
      for (let field_index = 0; field_index < count; field_index++) {
        const coroutine_saved_local = coroutine_layout.variant_fields[variant_index]![FieldIdx.from_usize(field_index)]!;
        const field_name_maybe = coroutine_layout.field_tys[coroutine_saved_local]!.debuginfo_name;
        const field_name = field_name_maybe !== undefined ? Symbol.as_str(field_name_maybe) : tuple_field_name(field_index);

        const field_type = variant_layout.field(cx, field_index).ty;

        state_specific_fields.push(
          build_field_di_node(
            cx,
            variant_struct_type_di_node,
            field_name,
            cx.layout_of(field_type),
            FieldsShape.offset(variant_layout.fields, field_index),
            llvm.DIFlags.FlagZero,
            type_di_node(cx, field_type),
            undefined,
          ),
        );
      }

      // Fields that are common to all states
      const common_fields: DIType[] = [];
      const upvar_tys = CoroutineArgs.upvar_tys(coroutine_args);
      const n = Math.min(upvar_tys.length, common_upvar_names.length);
      for (let index = 0; index < n; index++) {
        const upvar_ty = upvar_tys[index]!;
        const upvar_name = common_upvar_names[index]!;
        common_fields.push(
          build_field_di_node(
            cx,
            variant_struct_type_di_node,
            Symbol.as_str(upvar_name),
            cx.layout_of(upvar_ty),
            FieldsShape.offset(coroutine_type_and_layout.fields, index),
            llvm.DIFlags.FlagZero,
            type_di_node(cx, upvar_ty),
            undefined,
          ),
        );
      }

      return [...state_specific_fields, ...common_fields];
    },
    (cx) => build_generic_type_param_di_nodes(cx, coroutine_type_and_layout.ty),
  ).di_node;
}

// #[derive(Copy, Clone)]
export type DiscrResult = { readonly $: "NoDiscriminant" } | { readonly $: "Value"; readonly _0: bigint } | { readonly $: "Range"; readonly _0: bigint; readonly _1: bigint };

export const DiscrResult = {
  NoDiscriminant: Object.freeze({ $: "NoDiscriminant" }) as DiscrResult,

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:387 opt_single_val
  opt_single_val(self: DiscrResult): bigint | undefined {
    if (self.$ === "Value") {
      return self._0;
    } else {
      return undefined;
    }
  },
};

/// Returns the discriminant value corresponding to the variant index.
///
/// Will return `None` if there is less than two variants (because then the enum won't have)
/// a tag, and if this is the untagged variant of a niche-layout enum (because then there is no
/// single discriminant value).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/mod.rs:397 compute_discriminant_value
export function compute_discriminant_value(cx: CodegenCx, enum_type_and_layout: TyAndLayout, variant_index: VariantIdx): DiscrResult {
  const variants = enum_type_and_layout.layout.variants();
  switch (variants.$) {
    case "Single":
    case "Empty":
      return DiscrResult.NoDiscriminant;
    case "Multiple": {
      const tag_encoding = variants.tag_encoding;
      if (tag_encoding.$ === "Direct") {
        return { $: "Value", _0: unwrap(enum_type_and_layout.ty.discriminant_for_variant(cx.tcx, variant_index)).val };
      }
      const { niche_variants, niche_start, untagged_variant } = tag_encoding;
      const tag = variants.tag;
      const tag_size: Size = Scalar.size(tag, cx);
      if (variant_index === untagged_variant) {
        const valid_range = unwrap(enum_type_and_layout.for_variant(cx, variant_index).largest_niche).valid_range;

        let min = valid_range.start < valid_range.end ? valid_range.start : valid_range.end;
        min = tag_size.truncate(min);

        let max = valid_range.start > valid_range.end ? valid_range.start : valid_range.end;
        max = tag_size.truncate(max);

        return { $: "Range", _0: min, _1: max };
      } else {
        let value = BigInt.asUintN(128, BigInt.asUintN(128, BigInt(variant_index) - BigInt(niche_variants.start)) + niche_start);
        value = tag_size.truncate(value);
        return { $: "Value", _0: value };
      }
    }
  }
}
