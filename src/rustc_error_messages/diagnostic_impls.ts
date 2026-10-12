// Port of compiler/rustc_error_messages/src/diagnostic_impls.rs.
//
// PORT: every `impl IntoDiagArg for T` becomes a function `<T>_into_diag_arg(self, path)`; callers
// pair a value with its impl through `IntoDiagArg.of(value, <T>_into_diag_arg)` (see lib.ts).
// This module must only export hoisted `function`s that use lib.ts at call time: lib.ts imports it
// (ESM cycle), so top-level code here must not read lib.ts bindings.
import type { MutRef } from "../rustc_span/hygiene.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_char } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { DiagArgValue, IntoDiagArg, PathBuf } from "./lib.ts";

/** `pub struct DiagArgFromDisplay<'a>(pub &'a dyn fmt::Display);` */
// PORT: `&dyn fmt::Display` is a thunk producing the `Display` output.
export class DiagArgFromDisplay {
  constructor(public _0: () => string) {}
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:15 into_diag_arg
export function DiagArgFromDisplay_into_diag_arg(self: DiagArgFromDisplay, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(self._0(), path);
}

/** `impl<'a> From<&'a dyn fmt::Display> for DiagArgFromDisplay<'a>` */
// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:21 from
export function DiagArgFromDisplay_from_dyn(t: () => string): DiagArgFromDisplay {
  return new DiagArgFromDisplay(t);
}

/** `impl<'a, T: fmt::Display> From<&'a T> for DiagArgFromDisplay<'a>` */
// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:27 from
export function DiagArgFromDisplay_from<T>(t: T, display: (t: T) => string): DiagArgFromDisplay {
  return new DiagArgFromDisplay(() => display(t));
}

/** `impl<'a, T: Clone + IntoDiagArg> IntoDiagArg for &'a T` */
// PORT: references are erased; the clone is the value itself (`IntoDiagArg` values are immutable).
// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:33 into_diag_arg
export function ref_into_diag_arg(self: IntoDiagArg, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return self.into_diag_arg(path);
}

/**
 * `into_diag_arg_using_display!($ty)`: returns the generated `impl IntoDiagArg for $ty`, given the
 * type's `Display` (`to_string`). Used upstream for `std::io::Error`, `Box<dyn Error>`,
 * `NonZero<u32>`, `Edition`, `Ident`, `MacroRulesNormalizedIdent`, `ParseIntError`, `ExitStatus`
 * (and `ErrCode` in rustc_errors).
 */
export function into_diag_arg_using_display<T>(
  to_string: (self: T) => string,
): (self: T, path: MutRef<PathBuf | undefined>) => DiagArgValue {
  // rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:43 into_diag_arg
  function into_diag_arg(self: T, path: MutRef<PathBuf | undefined>): DiagArgValue {
    return String_into_diag_arg(to_string(self), path);
  }
  return into_diag_arg;
}

/**
 * `into_diag_arg_for_number!(i8, u8, i16, u16, i32, u32, i64, u64, i128, u128, isize, usize)`.
 * PORT: one function for every integer type (`number`, or `bigint` for 128-bit values).
 */
// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:55 into_diag_arg
export function number_into_diag_arg(self: number | bigint, path: MutRef<PathBuf | undefined>): DiagArgValue {
  // Convert to a string if it won't fit into `Number`.
  const n = typeof self === "bigint" ? self : BigInt(self);
  if (n >= -2147483648n && n <= 2147483647n) {
    return { $: "Number", _0: Number(n) };
  } else {
    return String_into_diag_arg(n.toString(), path);
  }
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:83 into_diag_arg
export function bool_into_diag_arg(self: boolean, _: MutRef<PathBuf | undefined>): DiagArgValue {
  if (self) {
    return { $: "Str", _0: "true" };
  } else {
    return { $: "Str", _0: "false" };
  }
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:93 into_diag_arg
export function char_into_diag_arg(self: number, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: debug_char(self) };
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:99 into_diag_arg
export function Vec_char_into_diag_arg(self: number[], _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "StrListSepByAnd", _0: self.map((c) => debug_char(c)) };
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:107 into_diag_arg
export function Symbol_into_diag_arg(self: Symbol, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(Symbol.to_ident_string(self), path);
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:113 into_diag_arg
export function str_into_diag_arg(self: string, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(self, path);
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:119 into_diag_arg
export function String_into_diag_arg(self: string, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: self };
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:125 into_diag_arg
export function Cow_into_diag_arg(self: string, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: self };
}

// PORT: paths are UTF-8 strings, so `Path::display()` is the string itself.
// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:131 into_diag_arg
export function Path_into_diag_arg(self: string, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: self };
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:137 into_diag_arg
export function PathBuf_into_diag_arg(self: PathBuf, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: self };
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:143 into_diag_arg
export function CString_into_diag_arg(_self: Uint8Array, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("std::ffi::CString::to_string_lossy (CString: IntoDiagArg)");
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:149 into_diag_arg
export function SmallCStr_into_diag_arg(_self: Uint8Array, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_data_structures::small_c_str::SmallCStr::to_string_lossy (SmallCStr: IntoDiagArg)");
}

// rustc: compiler/rustc_error_messages/src/diagnostic_impls.rs:155 into_diag_arg
export function Backtrace_into_diag_arg(self: Backtrace, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: self.to_string() };
}

/** `std::backtrace::BacktraceStatus` */
export type BacktraceStatus = "Unsupported" | "Disabled" | "Captured";

/**
 * PORT: shim for `std::backtrace::Backtrace` (move to src/std when root adds it). Only the
 * disabled case is modelled: `capture()` follows std's `RUST_LIB_BACKTRACE` / `RUST_BACKTRACE`
 * check and calls `unported` when backtraces are enabled (frame capture has no JS equivalent).
 */
export class Backtrace {
  private constructor(private readonly status_: BacktraceStatus) {}

  /** `Backtrace::capture` */
  static capture(): Backtrace {
    const lib = process.env["RUST_LIB_BACKTRACE"];
    const enabled = lib !== undefined ? lib !== "0" : (process.env["RUST_BACKTRACE"] ?? "0") !== "0";
    if (enabled) return unported("std::backtrace::Backtrace::capture (backtraces enabled)");
    return new Backtrace("Disabled");
  }

  /** `Backtrace::status` */
  status(): BacktraceStatus {
    return this.status_;
  }

  /** `impl Display for Backtrace` */
  to_string(): string {
    switch (this.status_) {
      case "Unsupported":
        return "unsupported backtrace";
      case "Disabled":
        return "disabled backtrace";
      case "Captured":
        return unported("std::backtrace::Backtrace Display (captured frames)");
    }
  }
}
