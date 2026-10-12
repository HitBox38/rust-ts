//! Parser for the `-l` command-line option, which links the generated crate to
//! a native library.
//!
//! (There is also a similar but separate syntax for `#[link]` attributes,
//! which have their own parser in `rustc_metadata`.)
// Partial port of compiler/rustc_session/src/config/native_libs.rs: only the entry point. Parsing an
// actual `-l` value needs `rustc_structures::NativeLibKind` and is unported.
import type { UnstableFeatures } from "../../rustc_feature/lib.ts";
import { UnstableFeatures as UF } from "../../rustc_feature/lib.ts";
import { unported } from "../../std/panic.ts";
import type { Matches } from "../../vendor/getopts/lib.ts";
import type { UnstableOptions } from "../options.ts";
import type { EarlyDiagCtxt } from "../session.ts";
import type { NativeLib } from "../utils.ts";

// rustc: compiler/rustc_session/src/config/native_libs.rs:18 parse_native_libs
export function parse_native_libs(
  early_dcx: EarlyDiagCtxt,
  unstable_opts: UnstableOptions,
  unstable_features: UnstableFeatures,
  matches: Matches,
): NativeLib[] {
  const cx: ParseNativeLibCx = {
    early_dcx,
    unstable_options_enabled: unstable_opts.unstable_options,
    is_nightly: UF.is_nightly_build(unstable_features),
  };
  return matches.opt_strs("l").map((value) => parse_native_lib(cx, value));
}

interface ParseNativeLibCx {
  early_dcx: EarlyDiagCtxt;
  unstable_options_enabled: boolean;
  is_nightly: boolean;
}

/// Parses the value of a single `-l` option.
// rustc: compiler/rustc_session/src/config/native_libs.rs:52 parse_native_lib
function parse_native_lib(_cx: ParseNativeLibCx, _value: string): NativeLib {
  return unported("rustc_session::config::native_libs::parse_native_lib (rustc_structures::NativeLibKind)");
}
