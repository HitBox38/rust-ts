// Port of compiler/rustc_structures/src/crate_type.rs
// The type is generated into crate_type.gen.ts; methods live on the companion (PORTING §8).
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import { String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as gen from "./crate_type.gen.ts";

export * from "./crate_type.gen.ts";

/// Crate type, as specified by `#![crate_type]`
export type CrateType = gen.CrateType;
export const CrateType = {
  ...gen.CrateType,

  /** `#[derive(Default)]` (`#[default] Rlib`) */
  default(): CrateType {
    return "Rlib";
  },

  /// Pairs of each `#[crate_type] = "..."` value and the crate type it resolves to
  // rustc: compiler/rustc_structures/src/crate_type.rs:31 all
  all(): readonly [Symbol, CrateType][] {
    // debug_assert_eq!(CrateType::default(), CrateType::Rlib);
    return [
      [sym.lib, "Rlib"],
      [sym.rlib, "Rlib"],
      [sym.dylib, "Dylib"],
      [sym.cdylib, "Cdylib"],
      [sym.staticlib, "StaticLib"],
      [sym.proc_dash_macro, "ProcMacro"],
      [sym.bin, "Executable"],
      [sym.sdylib, "Sdylib"],
    ];
  },

  /// Same as [`CrateType::all`], but does not include unstable options.
  /// Used for diagnostics.
  // rustc: compiler/rustc_structures/src/crate_type.rs:47 all_stable
  all_stable(): readonly [Symbol, CrateType][] {
    // debug_assert_eq!(CrateType::default(), CrateType::Rlib);
    return [
      [sym.lib, "Rlib"],
      [sym.rlib, "Rlib"],
      [sym.dylib, "Dylib"],
      [sym.cdylib, "Cdylib"],
      [sym.staticlib, "StaticLib"],
      [sym.proc_dash_macro, "ProcMacro"],
      [sym.bin, "Executable"],
    ];
  },

  // rustc: compiler/rustc_structures/src/crate_type.rs:62 has_metadata
  has_metadata(self: CrateType): boolean {
    switch (self) {
      case "Rlib":
      case "Dylib":
      case "ProcMacro":
        return true;
      case "Executable":
      case "Cdylib":
      case "StaticLib":
      case "Sdylib":
        return false;
    }
  },

  /** `impl TryFrom<Symbol> for CrateType` (`type Error = ()`) */
  // rustc: compiler/rustc_structures/src/crate_type.rs:77 try_from
  try_from(value: Symbol): Result<CrateType, null> {
    switch (value) {
      case sym.bin:
        return Ok("Executable");
      case sym.dylib:
        return Ok("Dylib");
      case sym.staticlib:
        return Ok("StaticLib");
      case sym.cdylib:
        return Ok("Cdylib");
      case sym.rlib:
        return Ok("Rlib");
      case sym.lib:
        return Ok(CrateType.default());
      case sym.proc_dash_macro:
        return Ok("ProcMacro");
      case sym.sdylib:
        return Ok("Sdylib");
      default:
        return Err(null);
    }
  },
};

// rustc: compiler/rustc_structures/src/crate_type.rs:93 fmt
export function display_CrateType(v: CrateType): string {
  switch (v) {
    case "Executable":
      return "bin";
    case "Dylib":
      return "dylib";
    case "Rlib":
      return "rlib";
    case "StaticLib":
      return "staticlib";
    case "Cdylib":
      return "cdylib";
    case "ProcMacro":
      return "proc-macro";
    case "Sdylib":
      return "sdylib";
  }
}

// rustc: compiler/rustc_structures/src/crate_type.rs:108 into_diag_arg
export function CrateType_into_diag_arg(self: CrateType, _: MutRef<string | undefined>): DiagArgValue {
  return String_into_diag_arg(display_CrateType(self), { value: undefined });
}
