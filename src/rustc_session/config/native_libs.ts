//! Parser for the `-l` command-line option, which links the generated crate to
//! a native library.
//!
//! (There is also a similar but separate syntax for `#[link]` attributes,
//! which have their own parser in `rustc_metadata`.)
import type { UnstableFeatures } from "../../rustc_feature/lib.ts";
import { UnstableFeatures as UF } from "../../rustc_feature/lib.ts";
import { NativeLibKind } from "../../rustc_structures/native_lib_kind.ts";
import type { Matches } from "../../vendor/getopts/lib.ts";
import type { UnstableOptions } from "../options.ts";
import type { EarlyDiagCtxt } from "../stand_ins.ts";
import type { NativeLib } from "../utils.ts";
import { unwrap } from "../../std/panic.ts";

/** PORT: `NativeLib { .. }` (utils.rs), installed by utils.ts: utils.ts imports config.ts, which imports this module (as `CanonicalizedPath_new_hook`). */
export const NativeLib_new_hook: { new_: ((name: string, new_name: string | undefined, kind: NativeLibKind, verbatim: boolean | undefined) => NativeLib) | undefined } = {
  new_: undefined,
};

/// Parses all `-l` options.
// rustc: compiler/rustc_session/src/config/native_libs.rs:18 parse_native_libs
export function parse_native_libs(
  early_dcx: EarlyDiagCtxt,
  unstable_opts: UnstableOptions,
  unstable_features: UnstableFeatures,
  matches: Matches,
): NativeLib[] {
  const cx = new ParseNativeLibCx(early_dcx, unstable_opts.unstable_options, UF.is_nightly_build(unstable_features));
  return matches.opt_strs("l").map((value) => parse_native_lib(cx, value));
}

class ParseNativeLibCx {
  constructor(
    public early_dcx: EarlyDiagCtxt,
    public unstable_options_enabled: boolean,
    public is_nightly: boolean,
  ) {}

  /// If unstable values are not permitted, exits with a fatal error made by
  /// combining the given strings.
  // rustc: compiler/rustc_session/src/config/native_libs.rs:41 on_unstable_value
  on_unstable_value(message: string, if_nightly: string, if_stable: string): void {
    if (this.unstable_options_enabled) {
      return;
    }

    const suffix = this.is_nightly ? if_nightly : if_stable;
    this.early_dcx.early_fatal(`${message}${suffix}`);
  }
}

/// Parses the value of a single `-l` option.
// rustc: compiler/rustc_session/src/config/native_libs.rs:52 parse_native_lib
function parse_native_lib(cx: ParseNativeLibCx, value: string): NativeLib {
  const { kind: kind_, modifiers, name, new_name } = split_native_lib_value(value);

  let kind: NativeLibKind;
  if (kind_ === undefined) {
    kind = NativeLibKind.Unspecified;
  } else {
    switch (kind_) {
      case "static":
        kind = { $: "Static", bundle: undefined, whole_archive: undefined, export_symbols: undefined };
        break;
      case "dylib":
        kind = { $: "Dylib", as_needed: undefined };
        break;
      case "framework":
        kind = { $: "Framework", as_needed: undefined };
        break;
      case "link-arg":
        cx.on_unstable_value(
          "library kind `link-arg` is unstable",
          ", the `-Z unstable-options` flag must also be passed to use it",
          " and only accepted on the nightly compiler",
        );
        kind = NativeLibKind.LinkArg;
        break;
      default:
        return cx.early_dcx.early_fatal(`unknown library kind \`${kind_}\`, expected one of: static, dylib, framework, link-arg`);
    }
  }

  // Provisionally create the result, so that modifiers can modify it.
  const native_lib = unwrap(NativeLib_new_hook.new_, "rustc_session::utils not loaded")(name, new_name, kind, undefined);

  if (modifiers !== undefined) {
    // If multiple modifiers are present, they are separated by commas.
    for (const modifier of modifiers.split(",")) {
      parse_and_apply_modifier(cx, modifier, native_lib);
    }
  }

  if (native_lib.name.length === 0) {
    cx.early_dcx.early_fatal("library name must not be empty");
  }

  return native_lib;
}

/// Parses one of the comma-separated modifiers (prefixed by `+` or `-`), and
/// modifies `native_lib` appropriately.
///
/// Exits with a fatal error if a malformed/unknown/inappropriate modifier is
/// found.
// rustc: compiler/rustc_session/src/config/native_libs.rs:101 parse_and_apply_modifier
function parse_and_apply_modifier(cx: ParseNativeLibCx, modifier_: string, native_lib: NativeLib): void {
  const early_dcx = cx.early_dcx;

  // Split off the leading `+` or `-` into a boolean value.
  // PORT: `split_at_checked(1)` gives `("+", m)`/`("-", m)` exactly when the first byte is that ASCII char; anything
  // else (empty, another char, a multi-byte first char) takes the fatal arm.
  const first = modifier_.charAt(0);
  if (first !== "+" && first !== "-") {
    early_dcx.early_fatal("invalid linking modifier syntax, expected '+' or '-' prefix before one of: bundle, verbatim, whole-archive, as-needed, export-symbols");
  }
  const modifier = modifier_.slice(1);
  const value = first === "+";

  // Assigns the value (from `+` or `-`) to an empty `Option<bool>`, or emits
  // a fatal error if the option has already been set.
  const assign_modifier = (opt_bool: boolean | undefined): boolean => {
    if (opt_bool !== undefined) {
      const msg = `multiple \`${modifier}\` modifiers in a single \`-l\` option`;
      early_dcx.early_fatal(msg);
    }
    return value;
  };

  // Check that the modifier is applicable to the native lib kind, and apply it.
  const kind = native_lib.kind;
  switch (modifier) {
    case "bundle":
      if (kind.$ === "Static") {
        kind.bundle = assign_modifier(kind.bundle);
      } else {
        early_dcx.early_fatal("linking modifier `bundle` is only compatible with `static` linking kind");
      }
      return;
    case "export-symbols":
      if (kind.$ === "Static") {
        kind.export_symbols = assign_modifier(kind.export_symbols);
      } else {
        early_dcx.early_fatal("linking modifier `export-symbols` is only compatible with `static` linking kind");
      }
      return;
    case "verbatim":
      native_lib.verbatim = assign_modifier(native_lib.verbatim);
      return;
    case "whole-archive":
      if (kind.$ === "Static") {
        kind.whole_archive = assign_modifier(kind.whole_archive);
      } else {
        early_dcx.early_fatal("linking modifier `whole-archive` is only compatible with `static` linking kind");
      }
      return;
    case "as-needed":
      if (kind.$ === "Dylib" || kind.$ === "Framework" || kind.$ === "RawDylib") {
        cx.on_unstable_value(
          "linking modifier `as-needed` is unstable",
          ", the `-Z unstable-options` flag must also be passed to use it",
          " and only accepted on the nightly compiler",
        );
        kind.as_needed = assign_modifier(kind.as_needed);
      } else {
        early_dcx.early_fatal("linking modifier `as-needed` is only compatible with `dylib` and `framework` linking kinds");
      }
      return;
    default:
      early_dcx.early_fatal(`unknown linking modifier \`${modifier}\`, expected one of: bundle, verbatim, whole-archive, as-needed, export-symbols`);
  }
}

// #[derive(Debug, PartialEq, Eq)]
export interface NativeLibParts {
  kind: string | undefined;
  modifiers: string | undefined;
  name: string;
  new_name: string | undefined;
}

/** `str::split_once(char)`. */
function split_once(s: string, c: string): [string, string] | undefined {
  const at = s.indexOf(c);
  return at < 0 ? undefined : [s.slice(0, at), s.slice(at + 1)];
}

/// Splits a string of the form `[KIND[:MODIFIERS]=]NAME[:NEW_NAME]` into those
/// individual parts. This cannot fail, but the resulting strings require
/// further validation.
// rustc: compiler/rustc_session/src/config/native_libs.rs:179 split_native_lib_value
export function split_native_lib_value(value: string): NativeLibParts {
  // Split the initial value into `[KIND=]NAME`.
  let name = value;
  let kind: string | undefined;
  const kind_name = split_once(name, "=");
  if (kind_name !== undefined) {
    [kind, name] = kind_name;
  } else {
    kind = undefined;
  }

  // Split the kind part, if present, into `KIND[:MODIFIERS]`.
  let modifiers: string | undefined;
  if (kind !== undefined) {
    const kind_modifiers = split_once(kind, ":");
    if (kind_modifiers !== undefined) {
      [kind, modifiers] = kind_modifiers;
    } else {
      modifiers = undefined;
    }
  } else {
    modifiers = undefined;
  }

  // Split the name part into `NAME[:NEW_NAME]`.
  let new_name: string | undefined;
  const name_new_name = split_once(name, ":");
  if (name_new_name !== undefined) {
    [name, new_name] = name_new_name;
  } else {
    new_name = undefined;
  }

  return { kind, modifiers, name, new_name };
}
