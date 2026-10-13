//! A module for searching for libraries
import { readdirSync } from "node:fs";
import type { PathBuf } from "../rustc_span/lib.ts";
import { relative_target_rustlib_path } from "../rustc_target/lib.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import { path_join } from "../std/path.ts";
import { unported } from "../std/panic.ts";
import { PathKind, type SearchPath } from "./search_paths.ts";

export class FileSearch {
  constructor(
    private readonly cli_search_paths_: SearchPath[],
    private readonly tlib_path: SearchPath,
    private readonly use_implicit_sysroot_deps: boolean,
    private readonly files: FileSearchCandidate[],
  ) {}

  // rustc: compiler/rustc_session/src/filesearch.rs:20 cli_search_paths
  cli_search_paths(kind: PathKind): SearchPath[] {
    return this.cli_search_paths_.filter((sp) => PathKind.matches(sp.kind, kind));
  }

  // rustc: compiler/rustc_session/src/filesearch.rs:24 search_paths
  search_paths(kind: PathKind): SearchPath[] {
    // If the crate is `PathKind::Crate` (a top level dependency)
    // and `-Z implicit-sysroot-deps=false`, then don't include the sysroot in the search paths.
    const exclude_sysroot = PathKind.matches(kind, "Crate") && !this.use_implicit_sysroot_deps;
    const maybe_tlib = !exclude_sysroot ? this.tlib_path : undefined;

    return [...this.cli_search_paths_.filter((sp) => PathKind.matches(sp.kind, kind)), ...(maybe_tlib !== undefined ? [maybe_tlib] : [])];
  }

  /// Return files from the search dirs of this filesearch that match the given `prefix` and
  /// `suffix` and have the given `kind`.
  ///
  /// Note that this function only searches files that match lib/staticlib/dlllib prefixes, not
  /// all files from the search paths!
  /// Access `search_paths` directly if you want to scan all files within them.
  // rustc: compiler/rustc_session/src/filesearch.rs:42 get_library_candidates
  get_library_candidates(prefix: string, suffix: string, kind: PathKind): [string, PathBuf][] {
    const exclude_sysroot = PathKind.matches(kind, "Crate") && !this.use_implicit_sysroot_deps;

    // The indices are clipped to have only a single iterator returned from this function, to
    // avoid allocating it.
    const start = Math.min(partition_point(this.files, (v) => byte_cmp(v.filename, prefix) < 0), this.files.length);
    const rest = this.files.slice(start);
    const end = partition_point(rest, (v) => v.filename.startsWith(prefix));
    const prefixed_items = rest.slice(0, end);

    return prefixed_items
      .filter((c) => PathKind.matches(c.kind, kind) && !(exclude_sysroot && c.from_sysroot) && c.filename.endsWith(suffix))
      .map((c): [string, PathBuf] => [c.filename.slice(prefix.length, c.filename.length - suffix.length), c.path()]);
  }

  // rustc: compiler/rustc_session/src/filesearch.rs:66 new
  static new(cli_search_paths: readonly SearchPath[], tlib_path: SearchPath, target: Target, use_implicit_sysroot_deps: boolean): FileSearch {
    // We keep a list of all found paths that look like libraries in `FileSearch`, to optimize
    // lookup in `get_library_candidates`.
    // These prefixes should be kept in sync with `CrateLocator::find_library_crate`.
    const prefixes = ["lib", target.staticlib_prefix, target.dll_prefix];

    // Load all files from all search paths, filter them by supported prefixes, and sort them,
    // so that we can efficiently look them up in `get_file_candidates` via binary search.
    const files: FileSearchCandidate[] = [];
    for (const [search_path, is_sysroot] of [
      ...cli_search_paths.map((path): [SearchPath, boolean] => [path, false]),
      [tlib_path, true] as [SearchPath, boolean],
    ]) {
      let dir: string[];
      try {
        dir = readdirSync(search_path.dir);
      } catch {
        continue;
      }
      // PORT: `entry.file_name().to_str()?` skips non-UTF-8 names; Node decodes names as UTF-8
      // (U+FFFD for invalid bytes), which no library file name contains.
      for (const filename of dir) {
        if (!prefixes.some((prefix) => filename.startsWith(prefix))) {
          continue;
        }
        files.push(new FileSearchCandidate(search_path.dir, filename, search_path.kind, is_sysroot));
      }
    }
    files.sort((lhs, rhs) => byte_cmp(lhs.filename, rhs.filename));

    return new FileSearch([...cli_search_paths], tlib_path, use_implicit_sysroot_deps, files);
  }
}

/** `<[T]>::partition_point` */
function partition_point<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(xs[mid]!)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `str`'s `Ord` (UTF-8 byte order = code point order). */
function byte_cmp(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/// This type stores `Box<str>` instead of `PathBuf` for the filename, because getting the
/// `file_name` of a `PathBuf` allocates, which is unnecessary. We have to go through the files
/// a lot of times, so storing file name and the directory separately saves time and memory.
///
/// The filename must be valid UTF-8. If it's not, the entry should be skipped, because all Rust
/// output files are valid UTF-8, and so a non-UTF-8 filename couldn't be one we're looking for.
// #[derive(Debug)]
class FileSearchCandidate {
  constructor(
    readonly dir: PathBuf,
    readonly filename: string,
    readonly kind: PathKind,
    /// Was this file added through the target sysroot?
    readonly from_sysroot: boolean,
  ) {}

  /// Constructs the full path to the file.
  // rustc: compiler/rustc_session/src/filesearch.rs:131 path
  path(): PathBuf {
    return path_join(this.dir, this.filename);
  }
}

// rustc: compiler/rustc_session/src/filesearch.rs:136 make_target_lib_path
export function make_target_lib_path(sysroot: PathBuf, target_triple: string): PathBuf {
  const rustlib_path = relative_target_rustlib_path(sysroot, target_triple);
  return path_join(path_join(sysroot, rustlib_path), "lib");
}

/// Returns a path to the target's `bin` folder within its `rustlib` path in the sysroot. This is
/// where binaries are usually installed, e.g. the self-contained linkers, lld-wrappers, LLVM tools,
/// etc.
// rustc: compiler/rustc_session/src/filesearch.rs:144 make_target_bin_path
export function make_target_bin_path(sysroot: PathBuf, target_triple: string): PathBuf {
  const rustlib_path = relative_target_rustlib_path(sysroot, target_triple);
  return path_join(path_join(sysroot, rustlib_path), "bin");
}

// Not ported (no markers): `dll_path` (filesearch.rs:153/220/261) and `current_dll_path` (:265) find the
// loaded `librustc_driver` through `dladdr`/`GetModuleFileNameW`; rust-ts has no such library.

/**
 * PORT: rust-ts has no sysroot of its own yet. Upstream `default_sysroot()` derives it from `argv[0]`
 * when that is a symlink (`from_env_args_next`) or from the path of the loaded `librustc_driver`
 * (`default_from_rustc_driver_dll`); neither has a TS counterpart (argv[0] is the Bun binary). This
 * marker path names no directory, so every filesystem probe below it fails (as for a sysroot without
 * any component). Pass `--sysroot` to point rust-ts at a real sysroot (M2+ suites pass the oracle's).
 */
export const DEFAULT_SYSROOT_STANDIN: PathBuf = "<rust-ts: default sysroot unported>";

/// This function checks if sysroot is found using env::args().next(), and if it
/// is not found, finds sysroot from current rustc_driver dll.
// not ported (no marker; filesearch.rs:279 default_sysroot, :280 default_from_rustc_driver_dll,
// :323 from_env_args_next): see `DEFAULT_SYSROOT_STANDIN`.
export function default_sysroot(): PathBuf {
  return DEFAULT_SYSROOT_STANDIN;
}

/** `current_dll_path` (not ported, see above). */
export function current_dll_path(): never {
  return unported("rustc_session::filesearch::current_dll_path");
}
