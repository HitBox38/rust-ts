// Port of compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs (lane cg-di-b, plan-m7 wave 40s).
//
// PORT (cg-di-b):
// - `struct VariantMemberInfo` is an interface; `variant_name: Cow<str>` is a `string`; `source_info` an optional
//   `[DIFile, c_uint]` pair.
// - `smallvec![x]` is `[x]`; `SmallVec` an array.
// - `variants.indices()` (an `IndexVec`) is `0..variants.len()`.
// - Renamed locals: `coroutine_def_id0` is the `ty::Coroutine` binding, as the closure's `let coroutine_def_id = if .. {
//   Some(coroutine_def_id) }` reads it in its own initializer (a TDZ error in TS); `file_metadata_` and `tag_base_type_`
//   would shadow the imported `file_metadata` and `tag_base_type` functions.
import { FieldsShape, Size } from "../../../../rustc_abi/lib.ts";
import type { VariantIdx } from "../../../../rustc_abi/layout.ts";
import { tag_base_type, wants_c_like_enum_debuginfo } from "../../../../rustc_codegen_ssa/debuginfo/mod.ts";
import { compute_debuginfo_type_name } from "../../../../rustc_codegen_ssa/debuginfo/type_names.ts";
import { debug_LayoutError, debug_TyAndLayout_Ty, type TyAndLayout } from "../../../../rustc_middle/ty/layout.ts";
import { debug_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../../rustc_span/def_id.ts";
import { Span } from "../../../../rustc_span/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../../../../std/fmt.ts";
import { assert } from "../../../../std/panic.ts";
import { unwrap_result } from "../../../../std/result.ts";
import { utf8_len } from "../../../../std/str.ts";
import type { CodegenCx } from "../../../context.ts";
import * as llvm from "../../../llvm/mod.ts";
import type { DIFile, DIType } from "../../../llvm/mod.ts";
import { create_DIArray, DIB, get_namespace_for_item } from "../../utils.ts";
import {
  create_member_type,
  file_metadata,
  file_metadata_from_def_id,
  NO_GENERICS,
  size_and_align_of,
  type_di_node,
  UNKNOWN_LINE_NUMBER,
  unknown_file_metadata,
  visibility_di_flags,
} from "../../metadata.ts";
import { DINodeCreationResult, Stub, StubInfo, UniqueTypeId } from "../type_map.ts";
import * as type_map from "../type_map.ts";
import { build_coroutine_variant_struct_type_di_node, build_enum_variant_struct_type_di_node, compute_discriminant_value, DiscrResult } from "./mod.ts";

/// Build the debuginfo node for an enum type. The listing below shows how such a
/// type looks like at the LLVM IR/DWARF level. It is a `DW_TAG_structure_type`
/// with a single `DW_TAG_variant_part` that in turn contains a `DW_TAG_variant`
/// for each variant of the enum. The variant-part also contains a single member
/// describing the discriminant, and a nested struct type for each of the variants.
///
/// ```txt
///  ---> DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
/// ```
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs:42 build_enum_type_di_node
export function build_enum_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const enum_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = enum_type.kind();
  if (k.$ !== "Adt") {
    return bug(`build_enum_type_di_node() called with non-enum type: \`${debug_Ty(enum_type, PLAIN)}\``);
  }
  const enum_adt_def = k._0;

  const containing_scope = get_namespace_for_item(cx, enum_adt_def.did());
  const enum_type_and_layout = cx.layout_of(enum_type);
  const enum_type_name = compute_debuginfo_type_name(cx.tcx, enum_type, false);

  const visibility_flags = visibility_di_flags(cx, enum_adt_def.did(), enum_adt_def.did());

  assert(!wants_c_like_enum_debuginfo(cx.tcx, enum_type_and_layout), "assertion failed: !wants_c_like_enum_debuginfo(cx.tcx, enum_type_and_layout)");

  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, enum_adt_def.did()) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, unique_type_id, enum_type_name, def_location, size_and_align_of(enum_type_and_layout), containing_scope, visibility_flags),
    (cx, enum_type_di_node) => {
      // Build the struct type for each variant. These will be referenced by the
      // DW_TAG_variant DIEs inside of the DW_TAG_variant_part DIE.
      // We also called the names for the corresponding DW_TAG_variant DIEs here.
      const variant_member_infos: VariantMemberInfo[] = [];
      const range = enum_adt_def.variant_range();
      for (let variant_index = range.start; variant_index < range.end; variant_index = (variant_index + 1) as VariantIdx) {
        variant_member_infos.push({
          variant_index,
          variant_name: Symbol.as_str(enum_adt_def.variant(variant_index).name),
          variant_struct_type_di_node: build_enum_variant_struct_type_di_node(
            cx,
            enum_type_and_layout,
            enum_type_di_node,
            variant_index,
            enum_adt_def.variant(variant_index),
            enum_type_and_layout.for_variant(cx, variant_index),
            visibility_flags,
          ),
          source_info: cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, enum_adt_def.variant(variant_index).def_id) : undefined,
        });
      }

      const enum_adt_def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? enum_adt_def.did() : undefined;
      return [build_enum_variant_part_di_node(cx, enum_type_and_layout, enum_type_di_node, enum_adt_def_id, variant_member_infos)];
    },
    // We don't seem to be emitting generic args on the enum type, it seems. Rather
    // they get attached to the struct type of each variant.
    NO_GENERICS,
  );
}

/// Build the debuginfo node for a coroutine environment. It looks the same as the debuginfo for
/// an enum. See [build_enum_type_di_node] for more information.
///
/// ```txt
///
///  ---> DW_TAG_structure_type              (top-level type for the coroutine)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
///
/// ```
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs:142 build_coroutine_di_node
export function build_coroutine_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const coroutine_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = coroutine_type.kind();
  if (k.$ !== "Coroutine") {
    return bug(`build_coroutine_di_node() called with non-coroutine type: \`${debug_Ty(coroutine_type, PLAIN)}\``);
  }
  const coroutine_def_id0 = k._0;
  const coroutine_args = k._1;

  const containing_scope = get_namespace_for_item(cx, coroutine_def_id0);
  const coroutine_type_and_layout = cx.layout_of(coroutine_type);

  assert(!wants_c_like_enum_debuginfo(cx.tcx, coroutine_type_and_layout), "assertion failed: !wants_c_like_enum_debuginfo(cx.tcx, coroutine_type_and_layout)");

  const coroutine_type_name = compute_debuginfo_type_name(cx.tcx, coroutine_type, false);

  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, coroutine_def_id0) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Struct,
      unique_type_id,
      coroutine_type_name,
      def_location,
      size_and_align_of(coroutine_type_and_layout),
      containing_scope,
      llvm.DIFlags.FlagZero,
    ),
    (cx, coroutine_type_di_node) => {
      const coroutine_layout = unwrap_result(cx.tcx.coroutine_layout(coroutine_def_id0, coroutine_args), debug_LayoutError);

      const v = coroutine_type_and_layout.variants;
      if (!(v.$ === "Multiple" && v.tag_encoding.$ === "Direct")) {
        return bug(`Encountered coroutine with non-direct-tag layout: ${format_debug(coroutine_type_and_layout, debug_TyAndLayout_Ty, PLAIN)}`);
      }
      const variants = v.variants;

      const common_upvar_names = cx.tcx.closure_saved_names_of_captured_variables(coroutine_def_id0);

      // Build variant struct types
      const variant_struct_type_di_nodes: VariantMemberInfo[] = [];
      for (let i = 0; i < variants.length; i++) {
        const variant_index = i as VariantIdx;
        // FIXME: This is problematic because just a number is not a valid identifier.
        //        CoroutineArgs::variant_name(variant_index), would be consistent
        //        with enums?
        const variant_name = `${variant_index}`;

        const span = coroutine_layout.variant_source_info[variant_index]!.span;
        let source_info: readonly [DIFile, number] | undefined;
        if (!Span.is_dummy(span)) {
          const loc = cx.lookup_debug_loc(Span.lo(span));
          source_info = [file_metadata(cx, loc.file), loc.line];
        } else {
          source_info = undefined;
        }

        variant_struct_type_di_nodes.push({
          variant_index,
          variant_name,
          variant_struct_type_di_node: build_coroutine_variant_struct_type_di_node(
            cx,
            variant_index,
            coroutine_type_and_layout,
            coroutine_type_di_node,
            coroutine_layout,
            common_upvar_names,
          ),
          source_info,
        });
      }

      const coroutine_def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? coroutine_def_id0 : undefined;
      return [build_enum_variant_part_di_node(cx, coroutine_type_and_layout, coroutine_type_di_node, coroutine_def_id, variant_struct_type_di_nodes)];
    },
    // We don't seem to be emitting generic args on the coroutine type, it seems. Rather
    // they get attached to the struct type of each variant.
    NO_GENERICS,
  );
}

/// Builds the DW_TAG_variant_part of an enum or coroutine debuginfo node:
///
/// ```txt
///       DW_TAG_structure_type              (top-level type for enum)
/// --->    DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
/// ```
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs:259 build_enum_variant_part_di_node
function build_enum_variant_part_di_node(
  cx: CodegenCx,
  enum_type_and_layout: TyAndLayout,
  enum_type_di_node: DIType,
  enum_type_def_id: DefId | undefined,
  variant_member_infos: readonly VariantMemberInfo[],
): DIType {
  const tag_member_di_node = build_discr_member_di_node(cx, enum_type_and_layout, enum_type_di_node);

  const variant_part_unique_type_id = UniqueTypeId.for_enum_variant_part(cx.tcx, enum_type_and_layout.ty);

  let file_metadata_: DIType;
  let line_number: number;
  if (cx.sess().opts.unstable_opts.debug_info_type_line_numbers) {
    [file_metadata_, line_number] = file_metadata_from_def_id(cx, enum_type_def_id);
  } else {
    [file_metadata_, line_number] = [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }

  const stub = StubInfo.new(cx, variant_part_unique_type_id, (cx, variant_part_unique_type_id_str) => {
    const variant_part_name = "";
    return llvm.LLVMRustDIBuilderCreateVariantPart(
      DIB(cx),
      enum_type_di_node,
      variant_part_name,
      utf8_len(variant_part_name),
      file_metadata_,
      line_number,
      BigInt(enum_type_and_layout.size.bits()),
      enum_type_and_layout.align.abi.bits() >>> 0,
      llvm.DIFlags.FlagZero,
      tag_member_di_node,
      create_DIArray(DIB(cx), []),
      variant_part_unique_type_id_str,
      utf8_len(variant_part_unique_type_id_str),
    );
  });

  return type_map.build_type_with_children(
    cx,
    stub,
    (cx, variant_part_di_node) =>
      variant_member_infos.map((variant_member_info) => build_enum_variant_member_di_node(cx, enum_type_and_layout, variant_part_di_node, variant_member_info)),
    NO_GENERICS,
  ).di_node;
}

/// Builds the DW_TAG_member describing where we can find the tag of an enum.
/// Returns `None` if the enum does not have a tag.
///
/// ```txt
///
///       DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
/// --->      DW_TAG_member                  (discriminant member)
///           DW_TAG_variant                 (variant 1)
///           DW_TAG_variant                 (variant 2)
///           DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
///
/// ```
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs:340 build_discr_member_di_node
function build_discr_member_di_node(cx: CodegenCx, enum_or_coroutine_type_and_layout: TyAndLayout, enum_or_coroutine_type_di_node: DIType): DIType | undefined {
  const tag_name = enum_or_coroutine_type_and_layout.ty.kind().$ === "Coroutine" ? "__state" : "";

  // NOTE: This is actually wrong. This will become a member of
  //       of the DW_TAG_variant_part. But, due to LLVM's API, that
  //       can only be constructed with this DW_TAG_member already in created.
  //       In LLVM IR the wrong scope will be listed but when DWARF is
  //       generated from it, the DW_TAG_member will be a child the
  //       DW_TAG_variant_part.
  const containing_scope = enum_or_coroutine_type_di_node;

  const variants = enum_or_coroutine_type_and_layout.layout.variants();
  switch (variants.$) {
    // A single-variant or no-variant enum has no discriminant.
    case "Single":
    case "Empty":
      return undefined;

    case "Multiple": {
      const tag_field = variants.tag_field;
      const tag_base_type_ = tag_base_type(cx.tcx, enum_or_coroutine_type_and_layout);
      const ty = type_di_node(cx, tag_base_type_);
      const file = unknown_file_metadata(cx);

      const layout = cx.layout_of(tag_base_type_);

      return create_member_type(
        cx,
        containing_scope,
        tag_name,
        file,
        UNKNOWN_LINE_NUMBER,
        layout,
        FieldsShape.offset(enum_or_coroutine_type_and_layout.fields, tag_field),
        llvm.DIFlags.FlagArtificial,
        ty,
      );
    }
  }
}

/// Build the debuginfo node for `DW_TAG_variant`:
///
/// ```txt
///       DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///  --->     DW_TAG_variant                 (variant 1)
///  --->     DW_TAG_variant                 (variant 2)
///  --->     DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
/// ```
///
/// This node looks like:
///
/// ```txt
/// DW_TAG_variant
///   DW_AT_discr_value           0
///   DW_TAG_member
///     DW_AT_name                  None
///     DW_AT_type                  <0x000002a1>
///     DW_AT_alignment             0x00000002
///     DW_AT_data_member_location  0
/// ```
///
/// The DW_AT_discr_value is optional, and is omitted if
///   - This is the only variant of a univariant enum (i.e. their is no discriminant)
///   - This is the "untagged" variant of a niche-layout enum
///     (where only the other variants are identified by a single value)
///
/// There is only ever a single member, the type of which is a struct that describes the
/// fields of the variant (excluding the discriminant). The name of the member is the name
/// of the variant as given in the source code. The DW_AT_data_member_location is always
/// zero.
///
/// Note that the LLVM DIBuilder API is a bit unintuitive here. The DW_TAG_variant subtree
/// (including the DW_TAG_member) is built by a single call to
/// `LLVMRustDIBuilderCreateVariantMemberType()`.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/enums/native.rs:424 build_enum_variant_member_di_node
function build_enum_variant_member_di_node(
  cx: CodegenCx,
  enum_type_and_layout: TyAndLayout,
  variant_part_di_node: DIType,
  variant_member_info: VariantMemberInfo,
): DIType {
  const variant_index = variant_member_info.variant_index;
  const discr_value = compute_discriminant_value(cx, enum_type_and_layout, variant_index);

  const [file_di_node, line_number] = variant_member_info.source_info ?? [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];

  const value = DiscrResult.opt_single_val(discr_value);
  let discr: llvm.Value | undefined;
  if (value !== undefined) {
    const tag_base_type_ = tag_base_type(cx.tcx, enum_type_and_layout);
    const size = cx.size_of(tag_base_type_);
    discr = cx.const_uint_big(cx.type_ix(size.bits()), value);
  } else {
    discr = undefined;
  }

  return llvm.LLVMRustDIBuilderCreateVariantMemberType(
    DIB(cx),
    variant_part_di_node,
    variant_member_info.variant_name,
    utf8_len(variant_member_info.variant_name),
    file_di_node,
    line_number,
    BigInt(enum_type_and_layout.size.bits()),
    enum_type_and_layout.align.abi.bits() >>> 0,
    BigInt(Size.ZERO.bits()),
    discr,
    llvm.DIFlags.FlagZero,
    variant_member_info.variant_struct_type_di_node,
  );
}

/// Information needed for building a `DW_TAG_variant`:
///
/// ```txt
///       DW_TAG_structure_type              (top-level type for enum)
///         DW_TAG_variant_part              (variant part)
///           DW_AT_discr                    (reference to discriminant DW_TAG_member)
///           DW_TAG_member                  (discriminant member)
///  --->     DW_TAG_variant                 (variant 1)
///  --->     DW_TAG_variant                 (variant 2)
///  --->     DW_TAG_variant                 (variant 3)
///         DW_TAG_structure_type            (type of variant 1)
///         DW_TAG_structure_type            (type of variant 2)
///         DW_TAG_structure_type            (type of variant 3)
/// ```
interface VariantMemberInfo {
  variant_index: VariantIdx;
  variant_name: string;
  variant_struct_type_di_node: DIType;
  source_info: readonly [DIFile, number] | undefined;
}

