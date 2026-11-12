// Port of compiler/rustc_codegen_ssa/src/debuginfo/mod.rs (lane ssa-debuginfo, plan-m7 wave 40o).
import { Float, Integer, Scalar, Size, Size_eq } from "../../rustc_abi/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { debug_TyAndLayout_Ty, IntegerExt, PrimitiveExt, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_str, format_debug, PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import * as type_names from "./type_names.ts";

// FIXME(eddyb) find a place for this (or a way to replace it).
// pub mod type_names;
export * as type_names from "./type_names.ts";

/// Returns true if we want to generate a DW_TAG_enumeration_type description for
/// this instead of a DW_TAG_struct_type with DW_TAG_variant_part.
///
/// NOTE: This is somewhat inconsistent right now: For empty enums and enums with a single
///       fieldless variant, we generate DW_TAG_struct_type, although a
///       DW_TAG_enumeration_type would be a better fit.
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/mod.rs:15 wants_c_like_enum_debuginfo
export function wants_c_like_enum_debuginfo(tcx: TyCtxt, enum_type_and_layout: TyAndLayout): boolean {
  const k = enum_type_and_layout.ty.kind();
  switch (k.$) {
    case "Adt": {
      const adt_def = k._0;
      if (!adt_def.is_enum()) {
        return false;
      }

      const tag_ty = type_names.cpp_like_debuginfo(tcx) ? tag_base_type_opt(tcx, enum_type_and_layout) : undefined;
      if (type_names.cpp_like_debuginfo(tcx) && tag_ty !== undefined && tag_ty.primitive_size(tcx).bits() === 128) {
        // C++-like debuginfo never uses the C-like representation for 128-bit enums.
        return false;
      }

      switch (adt_def.variants().length) {
        case 0:
          return false;
        case 1:
          // Univariant enums unless they are zero-sized
          return !Size_eq(enum_type_and_layout.size, Size.ZERO) && count(adt_def.all_fields()) === 0;
        default:
          // Enums with more than one variant if they have no fields
          return count(adt_def.all_fields()) === 0;
      }
    }
    default:
      return false;
  }
}

/// Extract the type with which we want to describe the tag of the given enum or coroutine.
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/mod.rs:51 tag_base_type
export function tag_base_type(tcx: TyCtxt, enum_type_and_layout: TyAndLayout): Ty {
  return (
    tag_base_type_opt(tcx, enum_type_and_layout) ??
    bug(`tag_base_type() called for enum without tag: ${format_debug(enum_type_and_layout, debug_TyAndLayout_Ty, PLAIN)}`)
  );
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/mod.rs:57 tag_base_type_opt
function tag_base_type_opt(tcx: TyCtxt, enum_type_and_layout: TyAndLayout): Ty | undefined {
  const k = enum_type_and_layout.ty.kind();
  assert(
    k.$ === "Coroutine" ? true : k.$ === "Adt" ? k._0.is_enum() : false,
    "assertion failed: match enum_type_and_layout.ty.kind() {\n    ty::Coroutine(..) => true,\n    ty::Adt(adt_def, _) => adt_def.is_enum(),\n    _ => false,\n}",
  );

  const variants = enum_type_and_layout.layout.variants();
  switch (variants.$) {
    // A single-variant or no-variant enum has no discriminant.
    case "Single":
    case "Empty":
      return undefined;

    case "Multiple": {
      const tag = variants.tag;
      if (variants.tag_encoding.$ === "Niche") {
        // Niche tags are always normalized to unsized integers of the correct size.
        const p = Scalar.primitive(tag);
        let int: Integer;
        switch (p.$) {
          case "Int":
            int = p._0;
            break;
          case "Float":
            int = unwrap_result(Integer.from_size(Float.size(p._0)), (e) => debug_str(e));
            break;
          // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
          case "Pointer":
            // If the niche is the NULL value of a reference, then `discr_enum_ty` will
            // be a RawPtr. CodeView doesn't know what to do with enums whose base type
            // is a pointer so we fix this up to just be `usize`.
            // DWARF might be able to deal with this but with an integer type we are on
            // the safe side there too.
            int = tcx.data_layout().ptr_sized_integer();
            break;
        }
        return IntegerExt.to_ty(int, tcx, false);
      }

      // `TagEncoding::Direct`: Direct tags preserve the sign.
      return PrimitiveExt.to_ty(Scalar.primitive(tag), tcx);
    }
  }
}

/** `Iterator::count`. */
function count<T>(it: Iterable<T>): number {
  let n = 0;
  for (const _ of it) n++;
  return n;
}
