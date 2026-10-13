//! Related to out filenames of compilation (e.g. binaries).
// Port of compiler/rustc_session/src/output.rs (lane driver-m2).
import "./options.ts"; // LOAD ORDER: see config.ts
import { statSync } from "node:fs";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { is_alphanumeric } from "../std/char.ts";
import { path_join } from "../std/path.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { Session } from "./session.ts";
import { type OutFileName, type OutputFilenames, path_set_extension } from "./config.ts";
import { CrateNameEmpty_diagnostic, FileIsNotWriteable_diagnostic, InvalidCharacterInCrateName_diagnostic } from "./diagnostics.gen.ts";

// rustc: compiler/rustc_session/src/output.rs:15 out_filename
export function out_filename(sess: Session, crate_type: CrateType, outputs: OutputFilenames, crate_name: Symbol): OutFileName {
  const default_filename = filename_for_input(sess, crate_type, crate_name, outputs);
  const exe = outputs.outputs.get("Exe");
  const out_filename = (exe !== undefined ? exe._0 : undefined) ?? outputs.single_output_file ?? default_filename;

  if (out_filename.$ === "Real") {
    const path = out_filename._0;
    check_file_is_writeable(path, sess);
  }

  return out_filename;
}

/// Make sure files are writeable. Mac, FreeBSD, and Windows system linkers
/// check this already -- however, the Linux linker will happily overwrite a
/// read-only file. We should be consistent.
// rustc: compiler/rustc_session/src/output.rs:39 check_file_is_writeable
export function check_file_is_writeable(file: PathBuf, sess: Session): void {
  if (!is_writeable(file)) {
    sess.dcx().emit_fatal(FileIsNotWriteable_diagnostic({ file }));
  }
}

// rustc: compiler/rustc_session/src/output.rs:45 is_writeable
function is_writeable(p: PathBuf): boolean {
  // `p.metadata()` (follows symlinks); `Permissions::readonly` is `mode & 0o222 == 0` on unix.
  // PORT: on Windows std reads FILE_ATTRIBUTE_READONLY; Node maps it onto the write bits of `mode`.
  let m;
  try {
    m = statSync(p);
  } catch {
    return true;
  }
  return !((m.mode & 0o222) === 0);
}

/// Validate the given crate name.
///
/// Note that this validation is more permissive than identifier parsing. It considers
/// non-empty sequences of alphanumeric and underscore characters to be valid crate names.
/// Most notably, it accepts names starting with a numeric character like `0`!
///
/// Furthermore, this shouldn't be taken as the canonical crate name validator.
/// Other places may use a more restrictive grammar (e.g., identifier or ASCII identifier).
// rustc: compiler/rustc_session/src/output.rs:60 validate_crate_name
export function validate_crate_name(sess: Session, crate_name: Symbol, span: Span | undefined): void {
  let guar: ErrorGuaranteed | undefined = undefined;

  if (Symbol.is_empty(crate_name)) {
    guar = sess.dcx().emit_err(CrateNameEmpty_diagnostic({ span }));
  }

  for (const ch of Symbol.as_str(crate_name)) {
    const c = ch.codePointAt(0)!;
    if (is_alphanumeric(c) || ch === "_") {
      continue;
    }
    guar = sess.dcx().emit_err(
      InvalidCharacterInCrateName_diagnostic({
        span,
        character: c,
        crate_name,
        suggestion:
          span === undefined
            ? {
                suggested_name: Array.from(Symbol.as_str(crate_name), (c) =>
                  c !== "_" && !is_alphanumeric(c.codePointAt(0)!) ? "_" : c,
                ).join(""),
              }
            : undefined,
      }),
    );
  }

  if (guar !== undefined) {
    guar.raise_fatal();
  }
}

// rustc: compiler/rustc_session/src/output.rs:87 filename_for_metadata
export function filename_for_metadata(sess: Session, outputs: OutputFilenames): OutFileName {
  const out_filename = outputs.path("Metadata");
  if (out_filename.$ === "Real") {
    const path = out_filename._0;
    check_file_is_writeable(path, sess);
  }
  return out_filename;
}

// rustc: compiler/rustc_session/src/output.rs:95 filename_for_input
export function filename_for_input(sess: Session, crate_type: CrateType, crate_name: Symbol, outputs: OutputFilenames): OutFileName {
  const libname = `${Symbol.as_str(crate_name)}${sess.opts.cg.extra_filename}`;

  switch (crate_type) {
    case "Rlib":
      return { $: "Real", _0: path_join(outputs.out_directory, `lib${libname}.rlib`) };
    case "Cdylib":
    case "ProcMacro":
    case "Dylib":
    case "Sdylib": {
      const [prefix, suffix] = [sess.target.dll_prefix, sess.target.dll_suffix];
      return { $: "Real", _0: path_join(outputs.out_directory, `${prefix}${libname}${suffix}`) };
    }
    case "StaticLib": {
      const [prefix, suffix] = sess.staticlib_components(false);
      return { $: "Real", _0: path_join(outputs.out_directory, `${prefix}${libname}${suffix}`) };
    }
    case "Executable": {
      const suffix: string = sess.target.exe_suffix;
      const out_filename = outputs.path("Exe");
      if (out_filename.$ === "Real") {
        const path = out_filename._0;
        if (suffix.length === 0) {
          return out_filename;
        } else {
          // `&suffix[1..]`: the suffix starts with the one-byte `.`.
          return { $: "Real", _0: path_set_extension(path, suffix.slice(1))[0] };
        }
      } else {
        return out_filename;
      }
    }
  }
}

/// Checks if target supports crate_type as output
// rustc: compiler/rustc_session/src/output.rs:132 invalid_output_for_target
export function invalid_output_for_target(sess: Session, crate_type: CrateType): boolean {
  if (crate_type === "Cdylib" || crate_type === "Dylib" || crate_type === "ProcMacro") {
    if (!sess.target.dynamic_linking) {
      return true;
    }
    if (sess.crt_static(crate_type) && !sess.target.crt_static_allows_dylibs) {
      return true;
    }
  }
  if (crate_type === "ProcMacro") {
    if (TargetTuple.eq(sess.opts.target_triple, sess.wasm_proc_macro_tuple) && sess.opts.unstable_opts.wasm_proc_macros) {
      return false;
    }
  }
  if ((crate_type === "ProcMacro" || crate_type === "Dylib") && sess.target.only_cdylib) {
    return true;
  }
  if (crate_type === "Executable" && !sess.target.executables) {
    return true;
  }

  return false;
}
