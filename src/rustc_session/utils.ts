// Port of compiler/rustc_session/src/utils.rs.
//
// PORT: the types of this file (`NativeLib`, `CanonicalizedPath`) are hand-written (the codegen set
// `rustc_session` only covers diagnostics.rs); `PathBuf` is a UTF-8 string (as in typemap.errors.json).
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { try_canonicalize } from "../rustc_fs_util/lib.ts";
import { type Debug, debug_bool, debug_option, debug_str, debug_struct } from "../std/fmt.ts";
import { args_os } from "../std/env.ts";
import { unported } from "../std/panic.ts";
// LOAD ORDER: options.ts before config.ts (see config.ts header).
import "./options.ts";
import { CanonicalizedPath_new_hook } from "./config.ts";
import { Session } from "./session.ts";
import type { VerboseTimingGuard } from "./stand_ins.ts";

// PORT: `impl Session { .. }` of this file is attached to the `Session` class (PORTING §5 "Methods
// defined in another file"); lib.ts imports this module after session.ts. `self.prof` is the
// `SelfProfilerRef` stand-in (stand_ins.ts).
declare module "./session.ts" {
  interface Session {
    timer(what: string): VerboseTimingGuard;
    time<R>(what: string, f: () => R): R;
  }
}

// rustc: compiler/rustc_session/src/utils.rs:12 timer
Session.prototype.timer = function (this: Session, what: string): VerboseTimingGuard {
  return this.prof.verbose_generic_activity(what);
};

/// Used by `-Z self-profile`.
// rustc: compiler/rustc_session/src/utils.rs:16 time
Session.prototype.time = function <R>(this: Session, what: string, f: () => R): R {
  return this.prof.verbose_generic_activity(what).run(f);
};

/** PORT: opaque stand-in for `rustc_structures::NativeLibKind` (rustc_structures is not ported). */
export type NativeLibKind = { readonly __standin: "rustc_structures::NativeLibKind" };
const debug_NativeLibKind: Debug<NativeLibKind> = () => unported("rustc_structures::NativeLibKind Debug");

// #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Encodable, Decodable)]
// #[derive(StableHash)]
export class NativeLib {
  constructor(
    public name: string,
    public new_name: string | undefined,
    public kind: NativeLibKind,
    public verbatim: boolean | undefined,
  ) {}

  // rustc: compiler/rustc_session/src/utils.rs:31 has_modifiers
  has_modifiers(): boolean {
    return this.verbatim !== undefined || unported("rustc_structures::NativeLibKind::has_modifiers");
  }
}
export const debug_NativeLib: Debug<NativeLib> = (v, f) =>
  debug_struct(f, "NativeLib", [
    ["name", debug_str(v.name)],
    ["new_name", debug_option(v.new_name, f, (s) => debug_str(s))],
    ["kind", debug_NativeLibKind(v.kind, f)],
    ["verbatim", debug_option(v.verbatim, f, debug_bool)],
  ]);

/// A path that has been canonicalized along with its original, non-canonicalized form
// #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
export class CanonicalizedPath {
  constructor(
    // Optional since canonicalization can sometimes fail
    public canonicalized_: PathBuf | undefined,
    public original_: PathBuf,
  ) {}

  // rustc: compiler/rustc_session/src/utils.rs:45 new
  static new(path: PathBuf): CanonicalizedPath {
    const canonicalized = try_canonicalize(path);
    return new CanonicalizedPath(canonicalized.$ === "Ok" ? canonicalized._0 : undefined, path);
  }

  // rustc: compiler/rustc_session/src/utils.rs:49 canonicalized
  canonicalized(): PathBuf {
    return this.canonicalized_ ?? this.original();
  }

  // rustc: compiler/rustc_session/src/utils.rs:53 original
  original(): PathBuf {
    return this.original_;
  }
}
// PORT: the fields `canonicalized` / `original` are `canonicalized_` / `original_` (their accessor
// methods keep the upstream names); Debug prints the upstream field names.
// PORT: config.ts's `parse_externs` reaches `CanonicalizedPath::new` through this hook (load order).
CanonicalizedPath_new_hook.new_ = (path) => CanonicalizedPath.new(path);
export const debug_CanonicalizedPath: Debug<CanonicalizedPath> = (v, f) =>
  debug_struct(f, "CanonicalizedPath", [
    ["canonicalized", debug_option(v.canonicalized_, f, (p) => debug_str(p))],
    ["original", debug_str(v.original_)],
  ]);

/// Gets a list of extra command-line flags provided by the user, as strings.
///
/// This function is used during ICEs to show more information useful for
/// debugging, since some ICEs only happens with non-default compiler flags
/// (and the users don't always report them).
// rustc: compiler/rustc_session/src/utils.rs:63 extra_compiler_flags
export function extra_compiler_flags(): [string[], boolean] | undefined {
  const ICE_REPORT_COMPILER_FLAGS: readonly string[] = ["-Z", "-C", "--crate-type"];

  const ICE_REPORT_COMPILER_FLAGS_EXCLUDE: readonly string[] = ["metadata", "extra-filename"];

  const ICE_REPORT_COMPILER_FLAGS_STRIP_VALUE: readonly string[] = ["incremental"];

  // `env::args_os().map(|arg| arg.to_string_lossy().to_string())` (src/std/env.ts: argv[0] is the
  // script path, standing for the program name).
  const lossy = new TextDecoder("utf-8", { ignoreBOM: true });
  const args = args_os()
    .map((arg) => lossy.decode(arg))
    [globalThis.Symbol.iterator]();

  const result: string[] = [];
  let excluded_cargo_defaults = false;
  for (let next = args.next(); !next.done; next = args.next()) {
    const arg = next.value;
    const a = ICE_REPORT_COMPILER_FLAGS.find((a) => arg.startsWith(a));
    if (a !== undefined) {
      let content: string;
      // PORT: `a` is ASCII, so its byte length is its UTF-16 length.
      if (arg.length === a.length) {
        // A space-separated option, like `-C incremental=foo` or `--crate-type rlib`
        const n = args.next();
        if (n.done) continue;
        content = n.value;
      } else if (arg.slice(a.length, a.length + 1) === "=") {
        // An equals option, like `--crate-type=rlib`
        content = arg.slice(a.length + 1);
      } else {
        // A non-space option, like `-Cincremental=foo`
        content = arg.slice(a.length);
      }
      const eq = content.indexOf("=");
      const option = eq >= 0 ? content.slice(0, eq) : content;
      if (ICE_REPORT_COMPILER_FLAGS_EXCLUDE.includes(option)) {
        excluded_cargo_defaults = true;
      } else {
        result.push(a);
        result.push(ICE_REPORT_COMPILER_FLAGS_STRIP_VALUE.includes(option) ? `${option}=[REDACTED]` : content);
      }
    }
  }

  return result.length !== 0 ? [result, excluded_cargo_defaults] : undefined;
}

let FROM_CARGO: boolean | undefined;

/// Returns whenever rustc was launched by Cargo as opposed to another build system.
///
/// To be used in diagnostics to avoid printing Cargo specific suggestions to other
/// build systems (like Bazel, Buck2, Makefile, ...).
// rustc: compiler/rustc_session/src/utils.rs:110 was_invoked_from_cargo
export function was_invoked_from_cargo(): boolean {
  // static FROM_CARGO: OnceLock<bool> = OnceLock::new();

  // To be able to detect Cargo, we use the simplest and least intrusive
  // way: we check whenever the `CARGO_CRATE_NAME` env is set.
  //
  // Note that it is common in Makefiles to define the `CARGO` env even
  // though we may not have been called by Cargo, so we avoid using it.
  FROM_CARGO ??= process.env["CARGO_CRATE_NAME"] !== undefined;
  return FROM_CARGO;
}
