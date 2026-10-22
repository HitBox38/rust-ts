//! Pattern analysis sometimes wants to print patterns as part of a user-visible
//! diagnostic.
//!
//! Historically it did so by creating a synthetic [`thir::Pat`](rustc_middle::thir::Pat)
//! and printing that, but doing so was making it hard to modify the THIR pattern
//! representation for other purposes.
//!
//! So this module contains a forked copy of `thir::Pat` that is used _only_
//! for diagnostics, and has been partly simplified to remove things that aren't
//! needed for printing.
//
// Port of compiler/rustc_pattern_analysis/src/rustc/print.rs (declarations: lane pat-b; bodies: lane pat-c).
// `f: &mut impl fmt::Write` is a `MutRef<string>` the fn appends to, and `fmt::Result` is `PrintResult` (rustc_middle
// ty/print: `Result<(), fmt::Error>`).
// PORT: every caller writes into a `String`, whose `fmt::Write` never fails: the `write!(..)?`s append to `f.value`
// and the fns return `Ok(())` (`PRINT_OK`).
import type { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { Ty, VariantDef } from "../../rustc_middle/ty/mod.ts";
import { PRINT_OK, type PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import { display_Ty, with_types_for_suggestion } from "../../rustc_middle/ty/print/pretty.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Symbol, sym } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";

// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc/print.rs:19 FieldPat
export interface FieldPat {
  field: FieldIdx;
  pattern: string;
  is_wildcard: boolean;
}

/// Returns a closure that will return `""` when called the first time,
/// and then return `", "` when called any subsequent times.
/// Useful for printing comma-separated lists.
// rustc: compiler/rustc_pattern_analysis/src/rustc/print.rs:28 start_or_comma
function start_or_comma(): () => string {
  let first = true;
  return () => {
    if (first) {
      first = false;
      return "";
    } else {
      return ", ";
    }
  };
}

// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc/print.rs:41 EnumInfo
export type EnumInfo =
  | { readonly $: "Enum"; readonly adt_def: AdtDef; readonly variant_index: VariantIdx }
  | { readonly $: "NotEnum" };
export const EnumInfo = {
  NotEnum: Object.freeze({ $: "NotEnum" } as const) as EnumInfo,
};

// rustc: compiler/rustc_pattern_analysis/src/rustc/print.rs:46 write_struct_like
export function write_struct_like(
  f: MutRef<string>,
  tcx: TyCtxt,
  ty: Ty,
  enum_info: EnumInfo,
  subpatterns: readonly FieldPat[],
): PrintResult {
  let variant_and_name: [VariantDef, string] | undefined;
  switch (enum_info.$) {
    case "Enum": {
      const { adt_def, variant_index } = enum_info;
      const variant = adt_def.variant(variant_index);
      const adt_did = adt_def.did();
      const name =
        tcx.is_diagnostic_item(sym.Option, adt_did) || tcx.is_diagnostic_item(sym.Result, adt_did)
          ? display_Symbol(variant.name)
          : with_types_for_suggestion(() => `${tcx.def_path_str(adt_def.did())}::${display_Symbol(variant.name)}`);
      variant_and_name = [variant, name];
      break;
    }
    case "NotEnum": {
      const adt_def = ty.ty_adt_def();
      variant_and_name = adt_def === undefined ? undefined : [adt_def.non_enum_variant(), tcx.def_path_str(adt_def.did())];
      break;
    }
  }

  const start_or_comma_ = start_or_comma();

  if (variant_and_name !== undefined) {
    const [variant, name] = variant_and_name;
    f.value += name;

    // Only for Adt we can have `S {...}`,
    // which we handle separately here.
    if (variant.ctor === undefined) {
      f.value += " { ";

      let printed = 0;
      for (const { field, pattern, is_wildcard } of subpatterns) {
        if (is_wildcard) {
          continue;
        }
        const field_name = variant.fields[field]!.name;
        f.value += `${start_or_comma_()}${display_Symbol(field_name)}: ${pattern}`;
        printed += 1;
      }

      const adt = ty.ty_adt_def();
      const is_union = adt !== undefined && adt.is_union();
      if (printed < variant.fields.length && (!is_union || printed === 0)) {
        f.value += `${start_or_comma_()}..`;
      }

      f.value += " }";
      return PRINT_OK;
    }
  }

  const num_fields = variant_and_name === undefined ? subpatterns.length : variant_and_name[0].fields.length;
  if (num_fields !== 0 || variant_and_name === undefined) {
    f.value += "(";
    for (const { pattern } of subpatterns) {
      f.value += `${start_or_comma_()}${pattern}`;
    }
    if (ty.kind().$ === "Tuple" && num_fields === 1) {
      f.value += ",";
    }
    f.value += ")";
  }

  return PRINT_OK;
}

// rustc: compiler/rustc_pattern_analysis/src/rustc/print.rs:119 write_ref_like
export function write_ref_like(f: MutRef<string>, ty: Ty, subpattern: string): PrintResult {
  const kind = ty.kind();
  switch (kind.$) {
    case "Ref": {
      const mutbl = kind._2;
      f.value += `&${Mutability.prefix_str(mutbl)}`;
      break;
    }
    default:
      bug(`${display_Ty(ty)} is a bad ref pattern type`);
  }
  f.value += subpattern;
  return PRINT_OK;
}

// rustc: compiler/rustc_pattern_analysis/src/rustc/print.rs:133 write_slice_like
export function write_slice_like(
  f: MutRef<string>,
  prefix: readonly string[],
  has_dot_dot: boolean,
  suffix: readonly string[],
): PrintResult {
  const start_or_comma_ = start_or_comma();
  f.value += "[";
  for (const p of prefix) {
    f.value += `${start_or_comma_()}${p}`;
  }
  if (has_dot_dot) {
    f.value += `${start_or_comma_()}..`;
  }
  for (const p of suffix) {
    f.value += `${start_or_comma_()}${p}`;
  }
  f.value += "]";
  return PRINT_OK;
}
