// Port of compiler/rustc_codegen_ssa/src/back/rpath.rs (lane ssa-archive).
//
// PORT: `PathBuf`, `&Path` and `OsString` are `string`s (PORTING section 5): rpaths are built from UTF-8 paths, and the
// linker arguments are strings. The `debug!` traces are comments, as elsewhere.
import { diff_paths } from "../../vendor/pathdiff/lib.ts";
import { try_canonicalize } from "../../rustc_fs_util/lib.ts";
import { debug_str } from "../../std/fmt.ts";
import { debug_IoError } from "../../std/io.ts";
import { panic } from "../../std/panic.ts";
import { path_parent } from "../../std/path.ts";
import { unwrap_result } from "../../std/result.ts";

export interface RPathConfig {
  libs: readonly string[];
  out_filename: string;
  is_like_darwin: boolean;
  linker_is_gnu: boolean;
}

// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:16 get_rpath_linker_args
export function get_rpath_linker_args(config: RPathConfig): string[] {
  // debug!("preparing the RPATH!");

  const rpaths = get_rpaths(config);
  const args: string[] = []; // the minimum needed capacity

  for (const rpath of rpaths) {
    args.push("-rpath");
    args.push(rpath);
  }

  if (config.linker_is_gnu) {
    // Use DT_RUNPATH instead of DT_RPATH if available
    args.push("--enable-new-dtags");

    // Set DF_ORIGIN for substitute $ORIGIN
    args.push("-z");
    args.push("origin");
  }

  return args;
}

// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:39 get_rpaths
function get_rpaths(config: RPathConfig): string[] {
  // debug!("output: {:?}", config.out_filename.display());
  // debug!("libs:");
  // for libpath in config.libs {
  //     debug!("    {:?}", libpath.display());
  // }

  // Use relative paths to the libraries. Binaries can be moved
  // as long as they maintain the relative relationship to the
  // crates they depend on.
  const rpaths = get_rpaths_relative_to_output(config);

  // debug!("rpaths:");
  // for rpath in &rpaths {
  //     debug!("    {:?}", rpath);
  // }

  // Remove duplicates
  return minimize_rpaths(rpaths);
}

// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:60 get_rpaths_relative_to_output
function get_rpaths_relative_to_output(config: RPathConfig): string[] {
  return config.libs.map((a) => get_rpath_relative_to_output(config, a));
}

// PORT: exported for rpath/tests.test.ts (upstream's `mod tests` sees it through `use super::*`).
// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:64 get_rpath_relative_to_output
export function get_rpath_relative_to_output(config: RPathConfig, lib_: string): string {
  // Mac doesn't appear to support $ORIGIN
  const prefix = config.is_like_darwin ? "@loader_path" : "$ORIGIN";

  // Strip filenames
  let lib = path_parent(lib_);
  if (lib === undefined) panic("called `Option::unwrap()` on a `None` value");
  let output = path_parent(config.out_filename);
  if (output === undefined) panic("called `Option::unwrap()` on a `None` value");

  // If output or lib is empty, just assume it locates in current path
  lib = lib === "" ? "." : lib;
  output = output === "" ? "." : output;

  lib = unwrap_result(try_canonicalize(lib), debug_IoError);
  output = unwrap_result(try_canonicalize(output), debug_IoError);
  const relative = path_relative_from(lib, output);
  if (relative === undefined) panic(`couldn't create relative path from ${debug_str(output)} to ${debug_str(lib)}`);

  let rpath = prefix;
  rpath += "/";
  rpath += relative;
  return rpath;
}

// This routine is adapted from the *old* Path's `path_relative_from`
// function, which works differently from the new `relative_from` function.
// In particular, this handles the case on unix where both paths are
// absolute but with only the root as the common directory.
// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:91 path_relative_from
function path_relative_from(path: string, base: string): string | undefined {
  return diff_paths(path, base);
}

// PORT: exported for rpath/tests.test.ts (upstream's `mod tests` sees it through `use super::*`).
// rustc: compiler/rustc_codegen_ssa/src/back/rpath.rs:95 minimize_rpaths
export function minimize_rpaths(rpaths: readonly string[]): string[] {
  const set = new Set<string>();
  const minimized: string[] = [];
  for (const rpath of rpaths) {
    if (!set.has(rpath)) {
      set.add(rpath);
      minimized.push(rpath);
    }
  }
  return minimized;
}
