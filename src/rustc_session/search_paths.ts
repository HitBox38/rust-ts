// compiler/rustc_session/src/search_paths.rs
import type { PathBuf } from "../rustc_span/lib.ts";
import type { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { TargetTuple as TargetTupleImpl } from "../rustc_target/spec/tuple.ts";
import { type Debug, debug_str, debug_struct } from "../std/fmt.ts";
import { path_join } from "../std/path.ts";
import { make_target_lib_path } from "./filesearch.ts";
import type { EarlyDiagCtxt } from "./session.ts";

/// Directory containing object/library files, passed through the command-line `-L` flag.
// #[derive(Clone, Debug)]
export class SearchPath {
  constructor(
    readonly kind: PathKind,
    readonly dir: PathBuf,
  ) {}

  // rustc: compiler/rustc_session/src/search_paths.rs:36 from_cli_opt
  static from_cli_opt(sysroot: PathBuf, triple: TargetTuple, early_dcx: EarlyDiagCtxt, path: string, is_unstable_enabled: boolean): SearchPath {
    let kind: PathKind;
    let path_: string;
    if (path.startsWith("native=")) {
      [kind, path_] = ["Native", path.slice("native=".length)];
    } else if (path.startsWith("crate=")) {
      [kind, path_] = ["Crate", path.slice("crate=".length)];
    } else if (path.startsWith("dependency=")) {
      [kind, path_] = ["Dependency", path.slice("dependency=".length)];
    } else if (path.startsWith("framework=")) {
      [kind, path_] = ["Framework", path.slice("framework=".length)];
    } else if (path.startsWith("all=")) {
      [kind, path_] = ["All", path.slice("all=".length)];
    } else {
      [kind, path_] = ["All", path];
    }
    let dir: PathBuf;
    if (path_.startsWith("@RUSTC_BUILTIN")) {
      const stripped = path_.slice("@RUSTC_BUILTIN".length);
      if (!is_unstable_enabled) {
        early_dcx.early_fatal("the `-Z unstable-options` flag must also be passed to enable the use of `@RUSTC_BUILTIN`");
      }

      dir = path_join(path_join(make_target_lib_path(sysroot, TargetTupleImpl.tuple(triple)), "builtin"), stripped);
    } else {
      dir = path_;
    }
    if (dir === "") {
      early_dcx.early_fatal("empty search path given via `-L`");
    }

    return SearchPath.new(kind, dir);
  }

  // rustc: compiler/rustc_session/src/search_paths.rs:76 from_sysroot_and_triple
  static from_sysroot_and_triple(sysroot: PathBuf, triple: string): SearchPath {
    return SearchPath.new("All", make_target_lib_path(sysroot, triple));
  }

  // rustc: compiler/rustc_session/src/search_paths.rs:80 new
  private static new(kind: PathKind, dir: PathBuf): SearchPath {
    return new SearchPath(kind, dir);
  }
}
export const debug_SearchPath: Debug<SearchPath> = (v, f) =>
  debug_struct(f, "SearchPath", [
    ["kind", v.kind],
    ["dir", debug_str(v.dir)],
  ]);

// #[derive(PartialEq, Clone, Copy, Debug, Hash, Eq, Encodable, Decodable, StableHash)]
export type PathKind = "Native" | "Crate" | "Dependency" | "Framework" | "All";
export const PathKind = {
  Native: "Native",
  Crate: "Crate",
  Dependency: "Dependency",
  Framework: "Framework",
  All: "All",

  // rustc: compiler/rustc_session/src/search_paths.rs:27 matches
  matches(self: PathKind, kind: PathKind): boolean {
    if (self === "All" || kind === "All") {
      return true;
    }
    return self === kind;
  },
} as const;
