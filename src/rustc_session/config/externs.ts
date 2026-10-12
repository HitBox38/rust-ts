//! This module contains code to help parse and manipulate `--extern` arguments.
// Port of compiler/rustc_session/src/config/externs.rs (the `#[cfg(test)] mod tests` is not ported).
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { Diag } from "../../rustc_errors/diagnostic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { UnstableOptions } from "../options.ts";
import type { EarlyDiagCtxt } from "../session.ts";

/// Represents the pieces of an `--extern` argument.
export interface ExternOpt {
  crate_name: string;
  path: PathBuf | undefined;
  options: string | undefined;
}

/** `str::split_once(pat)` */
function split_once(s: string, pat: string): [string, string] | undefined {
  const i = s.indexOf(pat);
  return i < 0 ? undefined : [s.slice(0, i), s.slice(i + pat.length)];
}

/// Breaks out the major components of an `--extern` argument.
///
/// The options field will be a string containing comma-separated options that will need further
/// parsing and processing.
///
/// On error, the returned `Diag` is fatal.
// rustc: compiler/rustc_session/src/config/externs.rs:26 split_extern_opt
export function split_extern_opt(early_dcx: EarlyDiagCtxt, unstable_opts: UnstableOptions, extern_opt: string): Result<ExternOpt, Diag> {
  let name: string;
  let path: PathBuf | undefined;
  const np = split_once(extern_opt, "=");
  if (np === undefined) {
    [name, path] = [extern_opt, undefined];
  } else {
    [name, path] = [np[0], np[1]];
  }
  let options: string | undefined;
  let crate_name: string;
  const oc = split_once(name, ":");
  if (oc === undefined) {
    [options, crate_name] = [undefined, name];
  } else {
    const [opts, cn] = oc;
    if (unstable_opts.namespaced_crates && cn.startsWith(":")) {
      // If the name starts with `:`, we know this was actually something like `foo::bar` and
      // not a set of options. We can just use the original name as the crate name.
      [options, crate_name] = [undefined, name];
    } else {
      [options, crate_name] = [opts, cn];
    }
  }

  // Reject paths with more than two segments.
  if (unstable_opts.namespaced_crates && crate_name.split("::").length > 2) {
    return Err(early_dcx.early_struct_fatal(`crate name \`${crate_name}\` passed to \`--extern\` can have at most two segments.`));
  }

  if (!valid_crate_name(crate_name, unstable_opts)) {
    const error = early_dcx.early_struct_fatal(`crate name \`${crate_name}\` passed to \`--extern\` is not a valid ASCII identifier`);
    const adjusted_name = crate_name.replaceAll("-", "_");
    if (is_ascii_ident(adjusted_name)) {
      error.help(`consider replacing the dashes with underscores: \`${adjusted_name}\``);
    }
    return Err(error);
  }

  return Ok({ crate_name, path, options });
}

// rustc: compiler/rustc_session/src/config/externs.rs:70 valid_crate_name
function valid_crate_name(name: string, unstable_opts: UnstableOptions): boolean {
  const ab = split_once(name, "::");
  if (ab !== undefined && unstable_opts.namespaced_crates) {
    return is_ascii_ident(ab[0]) && is_ascii_ident(ab[1]);
  } else if (ab !== undefined) {
    return false;
  } else {
    return is_ascii_ident(name);
  }
}

// rustc: compiler/rustc_session/src/config/externs.rs:78 is_ascii_ident
function is_ascii_ident(string: string): boolean {
  const chars = Array.from(string);
  const start = chars[0];
  if (start !== undefined && (/^[A-Za-z]$/.test(start) || start === "_")) {
    return chars.slice(1).every((char) => /^[A-Za-z0-9]$/.test(char) || char === "_");
  } else {
    return false;
  }
}
