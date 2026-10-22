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
// Port of compiler/rustc_pattern_analysis/src/rustc/print.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-c's
// (how to fill a stub: rustc.ts header). `f: &mut impl fmt::Write` is a `MutRef<string>` the fn appends to, and
// `fmt::Result` is `PrintResult` (rustc_middle ty/print: `Result<(), fmt::Error>`).
import type { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";

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
// stub: compiler/rustc_pattern_analysis/src/rustc/print.rs:28 start_or_comma (lane pat-c)
function start_or_comma(): () => string {
  return unported("rustc_pattern_analysis::rustc::print::start_or_comma");
}

// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/rustc/print.rs:41 EnumInfo
export type EnumInfo =
  | { readonly $: "Enum"; readonly adt_def: AdtDef; readonly variant_index: VariantIdx }
  | { readonly $: "NotEnum" };
export const EnumInfo = {
  NotEnum: Object.freeze({ $: "NotEnum" } as const) as EnumInfo,
};

// stub: compiler/rustc_pattern_analysis/src/rustc/print.rs:46 write_struct_like (lane pat-c)
export function write_struct_like(
  _f: MutRef<string>,
  _tcx: TyCtxt,
  _ty: Ty,
  _enum_info: EnumInfo,
  _subpatterns: readonly FieldPat[],
): PrintResult {
  return unported("rustc_pattern_analysis::rustc::print::write_struct_like");
}

// stub: compiler/rustc_pattern_analysis/src/rustc/print.rs:119 write_ref_like (lane pat-c)
export function write_ref_like(_f: MutRef<string>, _ty: Ty, _subpattern: string): PrintResult {
  return unported("rustc_pattern_analysis::rustc::print::write_ref_like");
}

// stub: compiler/rustc_pattern_analysis/src/rustc/print.rs:133 write_slice_like (lane pat-c)
export function write_slice_like(
  _f: MutRef<string>,
  _prefix: readonly string[],
  _has_dot_dot: boolean,
  _suffix: readonly string[],
): PrintResult {
  return unported("rustc_pattern_analysis::rustc::print::write_slice_like");
}
