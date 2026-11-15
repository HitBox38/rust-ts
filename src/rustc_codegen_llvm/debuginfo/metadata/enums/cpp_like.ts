// Port of compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs (lane cg-di-b, plan-m7 wave 40s).
// The CPP-like (MSVC/CodeView) debuginfo of enums and coroutines; `cpp_like_debuginfo(tcx)` selects it.
//
// PORT (cg-di-b):
// - The module's long doc comment (`DW_TAG_union_type` layout, natvis) is upstream's; see the pinned file.
// - `u64`/`u128` values are `bigint`. `x as u64` is `BigInt.asUintN(64, x)`; `assert_eq!(v, v as u64 as u128)` compares
//   `v` with that.
// - `enum DiscrKind` (local to `build_variant_struct_wrapper_type_di_node`'s closure) is a `$`-tagged union; the
//   `build_assoc_const` closure is an arrow function.
// - `struct Split128` / `struct VariantFieldInfo` are interfaces.
// - `variant_indices: impl Iterator + Clone` is a `readonly VariantIdx[]` (it is iterated twice, as `clone()` allows).
// - `IndexVec<VariantIdx, DiscrResult>` is an array; `next_index()` is its length.
// - `Cow<'static, str>` names are `string`s; `PRE_ALLOCATED.get(i)`, else the formatted name.
import { Align, FieldsShape, Size } from "../../../../rustc_abi/lib.ts";
import type { FieldIdx, VariantIdx } from "../../../../rustc_abi/layout.ts";
import { tag_base_type, wants_c_like_enum_debuginfo } from "../../../../rustc_codegen_ssa/debuginfo/mod.ts";
import { compute_debuginfo_type_name } from "../../../../rustc_codegen_ssa/debuginfo/type_names.ts";
import type { AdtDef } from "../../../../rustc_middle/ty/adt.ts";
import { debug_TyAndLayout_Ty, type TyAndLayout } from "../../../../rustc_middle/ty/layout.ts";
import { Ty } from "../../../../rustc_middle/ty/mod.ts";
import { CoroutineArgsExt } from "../../../../rustc_middle/ty/sty.ts";
import { debug_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../../rustc_span/def_id.ts";
import { Span } from "../../../../rustc_span/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../../../../std/fmt.ts";
import { assert, panic, unreachable } from "../../../../std/panic.ts";
import { unwrap_result } from "../../../../std/result.ts";
import { utf8_len } from "../../../../std/str.ts";
import type { CodegenCx } from "../../../context.ts";
import * as llvm from "../../../llvm/mod.ts";
import type { DIFile, DIFlags, DIType, Metadata, Value } from "../../../llvm/mod.ts";
import { DIB } from "../../utils.ts";
import { DW_TAG_const_type } from "../../dwarf_const.ts";
import {
  build_field_di_node,
  create_member_type,
  file_metadata,
  file_metadata_from_def_id,
  NO_GENERICS,
  NO_SCOPE_METADATA,
  size_and_align_of,
  type_di_node,
  UNKNOWN_LINE_NUMBER,
  unknown_file_metadata,
  visibility_di_flags,
} from "../../metadata.ts";
import { DINodeCreationResult, Stub, UniqueTypeId } from "../type_map.ts";
import * as type_map from "../type_map.ts";
import { build_coroutine_variant_struct_type_di_node, build_enum_variant_struct_type_di_node, build_enumeration_type_di_node, compute_discriminant_value, DiscrResult } from "./mod.ts";

// The names of the associated constants in each variant wrapper struct.
// These have to match up with the names being used in `intrinsic.natvis`.
const ASSOC_CONST_DISCR_NAME = "NAME";
const ASSOC_CONST_DISCR_EXACT = "DISCR_EXACT";
const ASSOC_CONST_DISCR_BEGIN = "DISCR_BEGIN";
const ASSOC_CONST_DISCR_END = "DISCR_END";

const ASSOC_CONST_DISCR128_EXACT_LO = "DISCR128_EXACT_LO";
const ASSOC_CONST_DISCR128_EXACT_HI = "DISCR128_EXACT_HI";
const ASSOC_CONST_DISCR128_BEGIN_LO = "DISCR128_BEGIN_LO";
const ASSOC_CONST_DISCR128_BEGIN_HI = "DISCR128_BEGIN_HI";
const ASSOC_CONST_DISCR128_END_LO = "DISCR128_END_LO";
const ASSOC_CONST_DISCR128_END_HI = "DISCR128_END_HI";

// The name of the tag field in the top-level union
const TAG_FIELD_NAME = "tag";
const TAG_FIELD_NAME_128_LO = "tag128_lo";
const TAG_FIELD_NAME_128_HI = "tag128_hi";

// We assign a "virtual" discriminant value to the sole variant of
// a single-variant enum.
const SINGLE_VARIANT_VIRTUAL_DISR: bigint = 0n;

/// In CPP-like mode, we generate a union with a field for each variant and an
/// explicit tag field. The field of each variant has a struct type
/// that encodes the discriminant of the variant and it's data layout.
/// The union also has a nested enumeration type that is only used for encoding
/// variant names in an efficient way. Its enumerator values do _not_ correspond
/// to the enum's discriminant values.
/// It's roughly equivalent to the following C/C++ code:
///
/// (See the pinned upstream file for the full listing and its explanation.)
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:182 build_enum_type_di_node
export function build_enum_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const enum_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = enum_type.kind();
  if (k.$ !== "Adt") {
    return bug(`build_enum_type_di_node() called with non-enum type: \`${debug_Ty(enum_type, PLAIN)}\``);
  }
  const enum_adt_def = k._0;

  const enum_type_and_layout = cx.layout_of(enum_type);
  const enum_type_name = compute_debuginfo_type_name(cx.tcx, enum_type, false);

  assert(!wants_c_like_enum_debuginfo(cx.tcx, enum_type_and_layout), "assertion failed: !wants_c_like_enum_debuginfo(cx.tcx, enum_type_and_layout)");

  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, enum_adt_def.did()) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Union,
      unique_type_id,
      enum_type_name,
      def_location,
      cx.size_and_align_of(enum_type),
      NO_SCOPE_METADATA,
      visibility_di_flags(cx, enum_adt_def.did(), enum_adt_def.did()),
    ),
    (cx, enum_type_di_node) => {
      const variants = enum_type_and_layout.variants;
      switch (variants.$) {
        case "Empty":
          // We don't generate any members for uninhabited types.
          return [];
        case "Single":
          return build_single_variant_union_fields(cx, enum_adt_def, enum_type_and_layout, enum_type_di_node, variants.index);
        case "Multiple": {
          const indices = variants.variants.map((_, i) => i as VariantIdx);
          if (variants.tag_encoding.$ === "Direct") {
            return build_union_fields_for_enum(cx, enum_adt_def, enum_type_and_layout, enum_type_di_node, indices, variants.tag_field, undefined);
          } else {
            return build_union_fields_for_enum(
              cx,
              enum_adt_def,
              enum_type_and_layout,
              enum_type_di_node,
              indices,
              variants.tag_field,
              variants.tag_encoding.untagged_variant,
            );
          }
        }
      }
    },
    NO_GENERICS,
  );
}

/// A coroutine debuginfo node looks the same as a that of an enum type.
///
/// See [build_enum_type_di_node] for more information.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:264 build_coroutine_di_node
export function build_coroutine_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const coroutine_type = UniqueTypeId.expect_ty(unique_type_id);
  let def_location;
  if (cx.sess().opts.unstable_opts.debug_info_type_line_numbers) {
    const k = coroutine_type.kind();
    if (k.$ !== "Coroutine") {
      return bug(`build_coroutine_di_node() called with non-coroutine type: \`${debug_Ty(coroutine_type, PLAIN)}\``);
    }
    def_location = file_metadata_from_def_id(cx, k._0);
  } else {
    def_location = undefined;
  }
  const coroutine_type_and_layout = cx.layout_of(coroutine_type);
  const coroutine_type_name = compute_debuginfo_type_name(cx.tcx, coroutine_type, false);

  assert(!wants_c_like_enum_debuginfo(cx.tcx, coroutine_type_and_layout), "assertion failed: !wants_c_like_enum_debuginfo(cx.tcx, coroutine_type_and_layout)");

  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Union,
      unique_type_id,
      coroutine_type_name,
      def_location,
      size_and_align_of(coroutine_type_and_layout),
      NO_SCOPE_METADATA,
      llvm.DIFlags.FlagZero,
    ),
    (cx, coroutine_type_di_node) => {
      const v = coroutine_type_and_layout.variants;
      if (v.$ === "Multiple" && v.tag_encoding.$ === "Direct") {
        return build_union_fields_for_direct_tag_coroutine(cx, coroutine_type_and_layout, coroutine_type_di_node);
      } else {
        return bug(`Encountered coroutine with non-direct-tag layout: ${format_debug(coroutine_type_and_layout, debug_TyAndLayout_Ty, PLAIN)}`);
      }
    },
    NO_GENERICS,
  );
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:315 build_single_variant_union_fields
function build_single_variant_union_fields(
  cx: CodegenCx,
  enum_adt_def: AdtDef,
  enum_type_and_layout: TyAndLayout,
  enum_type_di_node: DIType,
  variant_index: VariantIdx,
): DIType[] {
  const variant_layout = enum_type_and_layout.for_variant(cx, variant_index);
  const visibility_flags = visibility_di_flags(cx, enum_adt_def.did(), enum_adt_def.did());
  const variant_struct_type_di_node = build_enum_variant_struct_type_di_node(
    cx,
    enum_type_and_layout,
    enum_type_di_node,
    variant_index,
    enum_adt_def.variant(variant_index),
    variant_layout,
    visibility_flags,
  );

  const tag_base_type_ = cx.tcx.types.u32;
  const tag_base_type_di_node = type_di_node(cx, tag_base_type_);
  const tag_base_type_align = cx.align_of(tag_base_type_);

  const enum_adt_def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? enum_adt_def.did() : undefined;

  const variant_names_type_di_node = build_variant_names_type_di_node(
    cx,
    enum_type_di_node,
    [[variant_index, Symbol.as_str(enum_adt_def.variant(variant_index).name)]],
    enum_adt_def_id,
  );

  const variant_struct_type_wrapper_di_node = build_variant_struct_wrapper_type_di_node(
    cx,
    enum_type_and_layout,
    enum_type_di_node,
    variant_index,
    undefined,
    variant_struct_type_di_node,
    variant_names_type_di_node,
    tag_base_type_di_node,
    tag_base_type_,
    DiscrResult.NoDiscriminant,
    undefined,
  );

  return [
    build_field_di_node(
      cx,
      enum_type_di_node,
      variant_union_field_name(variant_index),
      // NOTE: We use the layout of the entire type, not from variant_layout
      //       since the later is sometimes smaller (if it has fewer fields).
      enum_type_and_layout,
      Size.ZERO,
      visibility_flags,
      variant_struct_type_wrapper_di_node,
      undefined,
    ),
    create_static_member_type(
      cx,
      enum_type_di_node,
      TAG_FIELD_NAME,
      unknown_file_metadata(cx),
      UNKNOWN_LINE_NUMBER,
      variant_names_type_di_node,
      visibility_flags,
      cx.const_u64(SINGLE_VARIANT_VIRTUAL_DISR),
      tag_base_type_align,
    ),
  ];
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:395 build_union_fields_for_enum
function build_union_fields_for_enum(
  cx: CodegenCx,
  enum_adt_def: AdtDef,
  enum_type_and_layout: TyAndLayout,
  enum_type_di_node: DIType,
  variant_indices: readonly VariantIdx[],
  tag_field: FieldIdx,
  untagged_variant_index: VariantIdx | undefined,
): DIType[] {
  const tag_base_type_ = tag_base_type(cx.tcx, enum_type_and_layout);

  const enum_adt_def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? enum_adt_def.did() : undefined;

  const variant_names_type_di_node = build_variant_names_type_di_node(
    cx,
    enum_type_di_node,
    (function* (): Generator<[VariantIdx, string]> {
      for (const variant_index of variant_indices) {
        const variant_name = Symbol.as_str(enum_adt_def.variant(variant_index).name);
        yield [variant_index, variant_name];
      }
    })(),
    enum_adt_def_id,
  );
  const visibility_flags = visibility_di_flags(cx, enum_adt_def.did(), enum_adt_def.did());

  const variant_field_infos: VariantFieldInfo[] = variant_indices.map((variant_index) => {
    const variant_layout = enum_type_and_layout.for_variant(cx, variant_index);

    const variant_def = enum_adt_def.variant(variant_index);

    const variant_struct_type_di_node = build_enum_variant_struct_type_di_node(
      cx,
      enum_type_and_layout,
      enum_type_di_node,
      variant_index,
      variant_def,
      variant_layout,
      visibility_flags,
    );

    return {
      variant_index,
      variant_struct_type_di_node,
      source_info: undefined,
      discr: compute_discriminant_value(cx, enum_type_and_layout, variant_index),
    };
  });

  return build_union_fields_for_direct_tag_enum_or_coroutine(
    cx,
    enum_type_and_layout,
    enum_type_di_node,
    variant_field_infos,
    variant_names_type_di_node,
    tag_base_type_,
    tag_field,
    untagged_variant_index,
    visibility_flags,
  );
}

// The base type of the VariantNames DW_AT_enumeration_type is always the same.
// It has nothing to do with the tag of the enum and just has to be big enough
// to hold all variant names.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:464 variant_names_enum_base_type
function variant_names_enum_base_type(cx: CodegenCx): Ty {
  return cx.tcx.types.u32;
}

/// This function builds a DW_AT_enumeration_type that contains an entry for
/// each variant. Note that this enumeration is just used for display variant
/// names -- it is not the actual type of the tag field.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:473 build_variant_names_type_di_node
function build_variant_names_type_di_node(
  cx: CodegenCx,
  containing_scope: DIType,
  variants: Iterable<readonly [VariantIdx, string]>,
  enum_def_id: DefId | undefined,
): DIType {
  // Create an enumerator for each variant.
  return build_enumeration_type_di_node(
    cx,
    "VariantNames",
    variant_names_enum_base_type(cx),
    (function* (): Generator<[string, bigint]> {
      for (const [variant_index, variant_name] of variants) yield [variant_name, BigInt(variant_index)];
    })(),
    enum_def_id,
    containing_scope,
  );
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:490 build_variant_struct_wrapper_type_di_node
function build_variant_struct_wrapper_type_di_node(
  cx: CodegenCx,
  enum_or_coroutine_type_and_layout: TyAndLayout,
  enum_or_coroutine_type_di_node: DIType,
  variant_index: VariantIdx,
  untagged_variant_index: VariantIdx | undefined,
  variant_struct_type_di_node: DIType,
  variant_names_type_di_node: DIType,
  tag_base_type_di_node: DIType,
  tag_base_type: Ty,
  discr0: DiscrResult,
  source_info: readonly [DIFile, number] | undefined,
): DIType {
  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Struct,
      UniqueTypeId.for_enum_variant_struct_type_wrapper(cx.tcx, enum_or_coroutine_type_and_layout.ty, variant_index),
      variant_struct_wrapper_type_name(variant_index),
      source_info,
      // NOTE: We use size and align of enum_type, not from variant_layout:
      size_and_align_of(enum_or_coroutine_type_and_layout),
      enum_or_coroutine_type_di_node,
      llvm.DIFlags.FlagZero,
    ),
    (cx, wrapper_struct_type_di_node) => {
      type DiscrKind =
        | { $: "Exact"; _0: bigint }
        | { $: "Exact128"; _0: bigint }
        | { $: "Range"; _0: bigint; _1: bigint }
        | { $: "Range128"; _0: bigint; _1: bigint };

      const [tag_base_type_size, tag_base_type_align] = cx.size_and_align_of(tag_base_type);
      const is_128_bits = tag_base_type_size.bits() > 64;

      let discr: DiscrKind;
      switch (discr0.$) {
        case "NoDiscriminant":
          discr = { $: "Exact", _0: SINGLE_VARIANT_VIRTUAL_DISR };
          break;
        case "Value": {
          const discr_val = discr0._0;
          if (is_128_bits) {
            discr = { $: "Exact128", _0: discr_val };
          } else {
            assert_eq_u128(discr_val, BigInt.asUintN(64, discr_val));
            discr = { $: "Exact", _0: BigInt.asUintN(64, discr_val) };
          }
          break;
        }
        case "Range": {
          const [min, max] = [discr0._0, discr0._1];
          if (variant_index !== untagged_variant_index) {
            panic(`assertion \`left == right\` failed\n  left: Some(${variant_index})\n right: ${untagged_variant_index === undefined ? "None" : `Some(${untagged_variant_index})`}`);
          }
          if (is_128_bits) {
            discr = { $: "Range128", _0: min, _1: max };
          } else {
            assert_eq_u128(min, BigInt.asUintN(64, min));
            assert_eq_u128(max, BigInt.asUintN(64, max));
            discr = { $: "Range", _0: BigInt.asUintN(64, min), _1: BigInt.asUintN(64, max) };
          }
          break;
        }
      }

      const fields: DIType[] = [];

      // We always have a field for the value
      fields.push(build_field_di_node(cx, wrapper_struct_type_di_node, "value", enum_or_coroutine_type_and_layout, Size.ZERO, llvm.DIFlags.FlagZero, variant_struct_type_di_node, undefined));

      const build_assoc_const = (name: string, type_di_node_: DIType, value: bigint, align0: Align): Metadata => {
        // FIXME: Currently we force all DISCR_* values to be u64's as LLDB seems to have
        // problems inspecting other value types. Since DISCR_* is typically only going to be
        // directly inspected via the debugger visualizer - which compares it to the `tag` value
        // (whose type is not modified at all) it shouldn't cause any real problems.
        let t_di: DIType;
        let align: Align;
        if (name === ASSOC_CONST_DISCR_NAME) {
          [t_di, align] = [type_di_node_, align0];
        } else {
          const ty_u64 = Ty.new_uint(cx.tcx, "U64");
          [t_di, align] = [type_di_node(cx, ty_u64), Align.EIGHT];
        }

        // must wrap type in a `const` modifier for LLDB to be able to inspect the value of the member
        const field_type = llvm.LLVMDIBuilderCreateQualifiedType(DIB(cx), DW_TAG_const_type, t_di);

        return create_static_member_type(
          cx,
          wrapper_struct_type_di_node,
          name,
          unknown_file_metadata(cx),
          UNKNOWN_LINE_NUMBER,
          field_type,
          llvm.DIFlags.FlagZero,
          cx.const_u64(value),
          align,
        );
      };

      // We also always have an associated constant for the discriminant value
      // of the variant.
      fields.push(build_assoc_const(ASSOC_CONST_DISCR_NAME, variant_names_type_di_node, BigInt(variant_index), cx.align_of(variant_names_enum_base_type(cx))));

      // Emit the discriminant value (or range) corresponding to the variant.
      switch (discr.$) {
        case "Exact": {
          const discr_val = discr._0;
          fields.push(build_assoc_const(ASSOC_CONST_DISCR_EXACT, tag_base_type_di_node, discr_val, tag_base_type_align));
          break;
        }
        case "Exact128": {
          const discr_val = discr._0;
          const align = cx.align_of(cx.tcx.types.u64);
          const type_di_node_ = type_di_node(cx, cx.tcx.types.u64);
          const { hi, lo } = split_128(discr_val);

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_EXACT_LO, type_di_node_, lo, align));

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_EXACT_HI, type_di_node_, hi, align));
          break;
        }
        case "Range": {
          const [begin, end] = [discr._0, discr._1];
          fields.push(build_assoc_const(ASSOC_CONST_DISCR_BEGIN, tag_base_type_di_node, begin, tag_base_type_align));

          fields.push(build_assoc_const(ASSOC_CONST_DISCR_END, tag_base_type_di_node, end, tag_base_type_align));
          break;
        }
        case "Range128": {
          const [begin, end] = [discr._0, discr._1];
          const align = cx.align_of(cx.tcx.types.u64);
          const type_di_node_ = type_di_node(cx, cx.tcx.types.u64);
          const { hi: begin_hi, lo: begin_lo } = split_128(begin);
          const { hi: end_hi, lo: end_lo } = split_128(end);

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_BEGIN_HI, type_di_node_, begin_hi, align));

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_BEGIN_LO, type_di_node_, begin_lo, align));

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_END_HI, type_di_node_, end_hi, align));

          fields.push(build_assoc_const(ASSOC_CONST_DISCR128_END_LO, type_di_node_, end_lo, align));
          break;
        }
      }

      return fields;
    },
    NO_GENERICS,
  ).di_node;
}

interface Split128 {
  hi: bigint;
  lo: bigint;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:702 split_128
function split_128(value: bigint): Split128 {
  return { hi: BigInt.asUintN(64, value >> 64n), lo: BigInt.asUintN(64, value) };
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:706 build_union_fields_for_direct_tag_coroutine
function build_union_fields_for_direct_tag_coroutine(cx: CodegenCx, coroutine_type_and_layout: TyAndLayout, coroutine_type_di_node: DIType): DIType[] {
  const v = coroutine_type_and_layout.variants;
  if (!(v.$ === "Multiple" && v.tag_encoding.$ === "Direct")) {
    return bug("This function only supports layouts with directly encoded tags.");
  }
  const tag_field = v.tag_field;

  const k = coroutine_type_and_layout.ty.kind();
  let coroutine_def_id: DefId;
  let coroutine_args;
  switch (k.$) {
    case "Coroutine":
      [coroutine_def_id, coroutine_args] = [k._0, k._1.as_coroutine()];
      break;
    default:
      return unreachable();
  }

  const coroutine_layout = unwrap_result(cx.tcx.coroutine_layout(coroutine_def_id, coroutine_args.args), () => "LayoutError");

  const common_upvar_names = cx.tcx.closure_saved_names_of_captured_variables(coroutine_def_id);
  const variant_range = CoroutineArgsExt.variant_range(coroutine_args, coroutine_def_id, cx.tcx);
  const variant_count = Math.max(0, variant_range.end - variant_range.start);

  const tag_base_type_ = tag_base_type(cx.tcx, coroutine_type_and_layout);

  const variant_indices: VariantIdx[] = [];
  for (let i = variant_range.start; i < variant_range.end; i = (i + 1) as VariantIdx) variant_indices.push(i);

  const variant_names_type_di_node = build_variant_names_type_di_node(
    cx,
    coroutine_type_di_node,
    (function* (): Generator<[VariantIdx, string]> {
      for (const variant_index of variant_indices) yield [variant_index, CoroutineArgsExt.variant_name(variant_index)];
    })(),
    cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? coroutine_def_id : undefined,
  );

  const discriminants: DiscrResult[] = (() => {
    const discriminants_iter = CoroutineArgsExt.discriminants(coroutine_args, coroutine_def_id, cx.tcx);
    const discriminants: DiscrResult[] = [];
    for (const [variant_index, discr] of discriminants_iter) {
      // Assert that the index in the IndexMap matches up with the given VariantIdx.
      if (variant_index !== discriminants.length) {
        panic(`assertion \`left == right\` failed\n  left: ${variant_index}\n right: ${discriminants.length}`);
      }
      discriminants.push({ $: "Value", _0: discr.val });
    }
    return discriminants;
  })();

  // Build the type node for each field.
  const variant_field_infos: VariantFieldInfo[] = variant_indices.map((variant_index) => {
    const variant_struct_type_di_node = build_coroutine_variant_struct_type_di_node(
      cx,
      variant_index,
      coroutine_type_and_layout,
      coroutine_type_di_node,
      coroutine_layout,
      common_upvar_names,
    );

    const span = coroutine_layout.variant_source_info[variant_index]!.span;
    let source_info: readonly [DIFile, number] | undefined;
    if (!Span.is_dummy(span)) {
      const loc = cx.lookup_debug_loc(Span.lo(span));
      source_info = [file_metadata(cx, loc.file), loc.line >>> 0];
    } else {
      source_info = undefined;
    }

    return {
      variant_index,
      variant_struct_type_di_node,
      source_info,
      discr: discriminants[variant_index]!,
    };
  });

  return build_union_fields_for_direct_tag_enum_or_coroutine(
    cx,
    coroutine_type_and_layout,
    coroutine_type_di_node,
    variant_field_infos,
    variant_names_type_di_node,
    tag_base_type_,
    tag_field,
    undefined,
    llvm.DIFlags.FlagZero,
  );
}

/// This is a helper function shared between enums and coroutines that makes sure fields have the
/// expect names.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:799 build_union_fields_for_direct_tag_enum_or_coroutine
function build_union_fields_for_direct_tag_enum_or_coroutine(
  cx: CodegenCx,
  enum_type_and_layout: TyAndLayout,
  enum_type_di_node: DIType,
  variant_field_infos: readonly VariantFieldInfo[],
  discr_type_di_node: DIType,
  tag_base_type_: Ty,
  tag_field: FieldIdx,
  untagged_variant_index: VariantIdx | undefined,
  di_flags: DIFlags,
): DIType[] {
  const tag_base_type_di_node = type_di_node(cx, tag_base_type_);
  const unions_fields: DIType[] = [];

  // We create a field in the union for each variant ...
  for (const variant_member_info of variant_field_infos) {
    const [file_di_node, line_number] = variant_member_info.source_info ?? [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];

    const field_name = variant_union_field_name(variant_member_info.variant_index);

    const variant_struct_type_wrapper = build_variant_struct_wrapper_type_di_node(
      cx,
      enum_type_and_layout,
      enum_type_di_node,
      variant_member_info.variant_index,
      untagged_variant_index,
      variant_member_info.variant_struct_type_di_node,
      discr_type_di_node,
      tag_base_type_di_node,
      tag_base_type_,
      variant_member_info.discr,
      cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? variant_member_info.source_info : undefined,
    );

    // We use create_member_type() member type directly because
    // the build_field_di_node() function does not support specifying a source location,
    // which is something that we don't do anywhere else.
    unions_fields.push(
      create_member_type(
        cx,
        enum_type_di_node,
        field_name,
        file_di_node,
        line_number,
        // NOTE: We use the layout of the entire type, not from variant_layout
        //       since the later is sometimes smaller (if it has fewer fields).
        enum_type_and_layout,
        // Union fields are always at offset zero
        Size.ZERO,
        di_flags,
        variant_struct_type_wrapper,
      ),
    );
  }

  {
    const [s0, a0] = cx.size_and_align_of(enum_type_and_layout.field(cx, tag_field).ty);
    const [s1, a1] = cx.size_and_align_of(tag_base_type(cx.tcx, enum_type_and_layout));
    if (!(s0.bytes() === s1.bytes() && a0.bytes() === a1.bytes())) {
      panic(`assertion \`left == right\` failed\n  left: (${s0.bytes()}, ${a0.bytes()})\n right: (${s1.bytes()}, ${a1.bytes()})`);
    }
  }

  // ... and a field for the tag. If the tag is 128 bits wide, this will actually
  // be two 64-bit fields.
  const is_128_bits = cx.size_of(tag_base_type_).bits() > 64;

  if (is_128_bits) {
    const type_di_node_ = type_di_node(cx, cx.tcx.types.u64);
    const u64_layout = cx.layout_of(cx.tcx.types.u64);

    let lo_offset0: number;
    let hi_offset0: number;
    switch (cx.tcx.data_layout().endian) {
      case "Little":
        [lo_offset0, hi_offset0] = [0, 8];
        break;
      case "Big":
        [lo_offset0, hi_offset0] = [8, 0];
        break;
    }

    const tag_field_offset = FieldsShape.offset(enum_type_and_layout.fields, tag_field).bytes();
    const lo_offset = Size.from_bytes(tag_field_offset + lo_offset0);
    const hi_offset = Size.from_bytes(tag_field_offset + hi_offset0);

    unions_fields.push(build_field_di_node(cx, enum_type_di_node, TAG_FIELD_NAME_128_LO, u64_layout, lo_offset, di_flags, type_di_node_, undefined));

    unions_fields.push(build_field_di_node(cx, enum_type_di_node, TAG_FIELD_NAME_128_HI, u64_layout, hi_offset, llvm.DIFlags.FlagZero, type_di_node_, undefined));
  } else {
    unions_fields.push(
      build_field_di_node(
        cx,
        enum_type_di_node,
        TAG_FIELD_NAME,
        enum_type_and_layout.field(cx, tag_field),
        FieldsShape.offset(enum_type_and_layout.fields, tag_field),
        di_flags,
        tag_base_type_di_node,
        undefined,
      ),
    );
  }

  return unions_fields;
}

/// Information about a single field of the top-level DW_TAG_union_type.
interface VariantFieldInfo {
  variant_index: VariantIdx;
  variant_struct_type_di_node: DIType;
  source_info: readonly [DIFile, number] | undefined;
  discr: DiscrResult;
}

const VARIANT_UNION_FIELD_NAMES: readonly string[] = [
  "variant0",
  "variant1",
  "variant2",
  "variant3",
  "variant4",
  "variant5",
  "variant6",
  "variant7",
  "variant8",
  "variant9",
  "variant10",
  "variant11",
  "variant12",
  "variant13",
  "variant14",
  "variant15",
];

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:925 variant_union_field_name
function variant_union_field_name(variant_index: VariantIdx): string {
  // const PRE_ALLOCATED: [&str; 16] (VARIANT_UNION_FIELD_NAMES, above)
  const s = VARIANT_UNION_FIELD_NAMES[variant_index];
  return s !== undefined ? s : `variant${variant_index}`;
}

const VARIANT_STRUCT_WRAPPER_TYPE_NAMES: readonly string[] = [
  "Variant0",
  "Variant1",
  "Variant2",
  "Variant3",
  "Variant4",
  "Variant5",
  "Variant6",
  "Variant7",
  "Variant8",
  "Variant9",
  "Variant10",
  "Variant11",
  "Variant12",
  "Variant13",
  "Variant14",
  "Variant15",
];

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:951 variant_struct_wrapper_type_name
function variant_struct_wrapper_type_name(variant_index: VariantIdx): string {
  // const PRE_ALLOCATED: [&str; 16] (VARIANT_STRUCT_WRAPPER_TYPE_NAMES, above)
  const s = VARIANT_STRUCT_WRAPPER_TYPE_NAMES[variant_index];
  return s !== undefined ? s : `Variant${variant_index}`;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs:977 create_static_member_type
function create_static_member_type(
  cx: CodegenCx,
  scope: Metadata,
  name: string,
  file: Metadata,
  line_number: number,
  ty: Metadata,
  flags: DIFlags,
  value: Value | undefined,
  align: Align,
): Metadata {
  return llvm.LLVMDIBuilderCreateStaticMemberType(DIB(cx), scope, name, utf8_len(name), file, line_number, ty, flags, value, align.bits() >>> 0);
}

/** `assert_eq!(v, v as u64 as u128)` */
function assert_eq_u128(left: bigint, right: bigint): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
  }
}
