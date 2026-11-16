// Port of src/tools/clippy/src/driver.rs (crate `clippy`, plan-m8 D4; lane clippy-contract-a): the `clippy-driver` binary.
// Run as `bun src/clippy/driver.ts <rustc args>` (the oracle's `clippy-driver <rustc args>`); the entry glue is at the end, as in
// src/miri/bin/miri.ts. A separate entry point (plan-m8 D12): no other entry imports this file, and the clippy crates
// (`clippy_lints`, `clippy_config`) load lazily, when `register_lints` runs, so `--rustc`, `--help` and the plain-rustc paths
// never load them.
//
// PORT (lane clippy-contract-a):
// - `#![feature(..)]`, `#![warn(..)]`, the `extern crate`s and `rustc_driver::override_c_allocator_in_binary!()` have no TS counterpart.
// - `rustc_driver::catch_with_exit_code` is ported for `()` (src/rustc_driver_impl/lib.ts); clippy's closure returns an `ExitCode`
//   (`T: Termination`). `catch_with_exit_code_` below is the generic form: the closure's value on `Ok` (`x.report()`), `FAILURE` on
//   `Err`, as upstream's `match catch_fatal_errors(f) { Ok(x) => x.report(), Err(_) => ExitCode::FAILURE }`.
// - `rustc_tools_util::get_version_info!()` is a macro of crate `rustc_tools_util` (`env!`/`option_env!` of its build script's
//   variables), not ported yet: `get_version_info` stops `unported`.
// - `color_print::cstr!` expands at compile time to a string with ANSI SGR codes; `help_message` holds that expansion, mirroring the
//   macro's tags (driver.test.ts compares it with the string in the pinned clippy-driver binary).
import { existsSync, readFileSync } from "node:fs";
import * as sym from "../clippy_utils/sym.gen.ts";
import { LintListBuilder } from "../declare_clippy_lint/lib.ts";
import { EXIT_FAILURE, EXIT_SUCCESS, type Callbacks, catch_with_exit_code, compiler_entrypoint, init_rustc_env_logger, install_ice_hook } from "../rustc_driver_impl/lib.ts";
import { raw_args } from "../rustc_driver_impl/args.ts";
import type { Config } from "../rustc_interface/interface.ts";
import { ErrorOutputType } from "../rustc_session/config.ts";
import { EarlyDiagCtxt, type Session } from "../rustc_session/session.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { Unported, unported } from "../std/panic.ts";
import { report_uncaught } from "../std/panicking.ts";
import { var_ } from "../std/env.ts";
import { ok } from "../std/result.ts";
import { str_lines } from "../std/str.ts";
import { write_stderr } from "../std/io.ts";
import { ensure_stack, selected_impl } from "../rust_ts/stack.ts";
import { stdout } from "../vendor/anstream/lib.ts";

/** `std::process::ExitCode` */
type ExitCode = number;
const ExitCode = { SUCCESS: EXIT_SUCCESS, FAILURE: EXIT_FAILURE } as const;

/// If a command-line option matches `find_arg`, then apply the predicate `pred` on its value. If
/// true, then return it. The parameter is assumed to be either `--arg=value` or `--arg value`.
// rustc: src/tools/clippy/src/driver.rs:33 arg_value
export function arg_value(args: readonly string[], find_arg: string, pred: (s: string) => boolean): boolean {
  let i = 0; // `let mut args = args.iter().map(String::as_str);`
  while (i < args.length) {
    const arg_ = args[i++]!;
    // `arg.splitn(2, '=')`
    const eq = arg_.indexOf("=");
    const first = eq < 0 ? arg_ : arg_.slice(0, eq);
    if (first !== find_arg) {
      continue;
    }

    // `arg.next().or_else(|| args.next())`
    const v = eq >= 0 ? arg_.slice(eq + 1) : i < args.length ? args[i++] : undefined;
    if (v !== undefined && pred(v)) {
      return true;
    }
  }
  return false;
}

/// Returns true if this is `arg` or `arg=...`, otherwise returns false.
// rustc: src/tools/clippy/src/driver.rs:50 is_arg
export function is_arg(argument: string, key: string): boolean {
  const s = strip_prefix(argument, key);
  return s !== undefined && (s.length === 0 || s.startsWith("="));
}

// #[test] fn test_arg_value (:57), fn test_has_arg (:74): driver.test.ts.

// rustc: src/tools/clippy/src/driver.rs:86 track_clippy_args
function track_clippy_args(sess: Session, args_env_var: string | undefined): void {
  // PORT: `Session.env_depinfo` holds the JSON text of each `(Symbol, Option<Symbol>)` pair (src/rustc_interface/passes.ts).
  sess.env_depinfo.add(JSON.stringify([Symbol.as_str(sym.CLIPPY_ARGS), args_env_var === undefined ? null : Symbol.as_str(Symbol.intern(args_env_var))]));
}

/// Track files that may be accessed at runtime in `file_depinfo` so that cargo will re-run clippy
/// when any of them are modified
// rustc: src/tools/clippy/src/driver.rs:94 track_files
function track_files(sess: Session): void {
  const file_depinfo = sess.file_depinfo;

  // Used by `clippy::cargo` lints and to determine the MSRV. `cargo clippy` executes `clippy-driver`
  // with the current directory set to `CARGO_MANIFEST_DIR` so a relative path is fine
  if (existsSync("Cargo.toml")) {
    file_depinfo.add(sym.Cargo_toml);
  }

  // `clippy.toml` will be automatically tracked as it's loaded with `sess.source_map().load_file()`

  // During development track the `clippy-driver` executable so that cargo will re-run clippy whenever
  // it is rebuilt
  // if cfg!(debug_assertions)
  //     && let Ok(current_exe) = env::current_exe()
  //     && let Some(current_exe) = current_exe.to_str()
  // {
  //     file_depinfo.insert(Symbol::intern(current_exe));
  // }
  // PORT: `cfg!(debug_assertions)` is false in the oracle's (release) build, so the block is not compiled (PORTING §3).
}

class DefaultCallbacks implements Callbacks {
  // impl rustc_driver::Callbacks for DefaultCallbacks {}: the provided `config` (an empty body)
  config(_config: Config): void {}
}

/// This is different from `DefaultCallbacks` that it will inform Cargo to track the value of
/// `CLIPPY_ARGS` environment variable.
class RustcCallbacks implements Callbacks {
  constructor(public clippy_args_var: string | undefined) {}

  // impl rustc_driver::Callbacks for RustcCallbacks
  // rustc: src/tools/clippy/src/driver.rs:125 config
  config(config: Config): void {
    const clippy_args_var = this.clippy_args_var; // `.take()`
    this.clippy_args_var = undefined;
    config.track_state = (sess) => {
      track_clippy_args(sess, clippy_args_var);
    };
    config.extra_symbols = [...sym.EXTRA_SYMBOLS];
  }
}

class ClippyCallbacks implements Callbacks {
  constructor(public clippy_args_var: string | undefined) {}

  // impl rustc_driver::Callbacks for ClippyCallbacks
  // #[expect(rustc::bad_opt_access, reason = "necessary in clippy driver to set `mir_opt_level`")]
  // rustc: src/tools/clippy/src/driver.rs:140 config
  config(config: Config): void {
    const previous = config.register_lints; // `.take()`
    config.register_lints = undefined;
    const clippy_args_var = this.clippy_args_var; // `.take()`
    this.clippy_args_var = undefined;
    config.track_state = (sess) => {
      track_clippy_args(sess, clippy_args_var);
      track_files(sess);

      // Trigger a rebuild if CLIPPY_CONF_DIR changes. The value must be a valid string so
      // changes between dirs that are invalid UTF-8 will not trigger rebuilds
      const dir = var_("CLIPPY_CONF_DIR");
      sess.env_depinfo.add(JSON.stringify([Symbol.as_str(sym.CLIPPY_CONF_DIR), dir.$ === "Ok" ? Symbol.as_str(Symbol.intern(dir._0)) : null]));
    };
    config.register_lints = (sess, lint_store) => {
      // technically we're ~guaranteed that this is none but might as well call anything that
      // is there already. Certainly it can't hurt.
      if (previous !== undefined) {
        previous(sess, lint_store);
      }

      // PORT (plan-m8 D12): the clippy crates load here, on first use.
      const clippy_lints = require("../clippy_lints/lib.ts") as typeof import("../clippy_lints/lib.ts");
      const clippy_config = require("../clippy_config/lib.ts") as typeof import("../clippy_config/lib.ts");

      const list_builder = LintListBuilder.default();
      list_builder.insert(clippy_lints.declared_lints.LINTS);
      list_builder.register(lint_store);

      const conf = clippy_config.Conf.load(sess);
      clippy_lints.register_lint_passes(lint_store, conf);

      // #[cfg(feature = "internal")]
      // clippy_lints_internal::register_lints(lint_store);
      // PORT: the `internal` feature is off in the oracle's build (plan-m8 §2b: `tests/ui-internal` is out).
    };
    config.extra_symbols = [...sym.EXTRA_SYMBOLS];

    // FIXME: #4825; This is required, because Clippy lints that are based on MIR have to be
    // run on the unoptimized MIR. On the other hand this results in some false negatives. If
    // MIR passes can be enabled / disabled separately, we should figure out, what passes to
    // use for Clippy.
    config.opts.unstable_opts.mir_opt_level = 0;
    config.opts.unstable_opts.mir_enable_passes = [
      ["CheckNull", false],
      ["CheckAlignment", false],
    ];

    // Disable flattening and inlining of format_args!(), so the HIR matches with the AST.
    config.opts.unstable_opts.flatten_format_args = false;
  }
}

// rustc: src/tools/clippy/src/driver.rs:186 display_help
function display_help(): ExitCode {
  if (stdout().lock().write_fmt([help_message(), "\n"]).$ === "Err") {
    return ExitCode.FAILURE;
  } else {
    return ExitCode.SUCCESS;
  }
}

const BUG_REPORT_URL = "https://github.com/rust-lang/rust-clippy/issues/new?template=ice.yml";

// rustc: src/tools/clippy/src/driver.rs:196 main
export function main(): ExitCode {
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());

  init_rustc_env_logger(early_dcx);

  install_ice_hook(BUG_REPORT_URL, (dcx) => {
    // FIXME: this macro calls unwrap internally but is called in a panicking context!  It's not
    // as simple as moving the call from the hook to main, because `install_ice_hook` doesn't
    // accept a generic closure.
    const version_info = get_version_info();
    dcx.note(`Clippy version: ${version_info}`);
  });

  return catch_with_exit_code_((): ExitCode => {
    // rustc: src/tools/clippy/src/driver.rs:210 has_sysroot_arg
    function has_sysroot_arg(args: readonly string[]): boolean {
      // https://doc.rust-lang.org/rustc/command-line-arguments.html#path-load-command-line-flags-from-a-path
      // Beside checking for existence of `--sysroot` on the command line, we need to
      // check for the arg files that are prefixed with @ as well to be consistent with rustc
      return args.some((arg) => {
        const arg_file_path = strip_prefix(arg, "@");
        const arg_file = arg_file_path === undefined ? undefined : read_to_string(arg_file_path);
        if (arg_file !== undefined) {
          return str_lines(arg_file).some((arg) => is_arg(arg, "--sysroot"));
        } else {
          return is_arg(arg, "--sysroot");
        }
      });
    }

    const orig_args = raw_args(early_dcx);

    const sys_root_env = ok(var_("SYSROOT"));
    const pass_sysroot_env_if_given = (args: string[], sys_root_env: string | undefined): void => {
      if (sys_root_env !== undefined && !has_sysroot_arg(args)) {
        args.push("--sysroot", sys_root_env);
      }
    };

    // make "clippy-driver --rustc" work like a subcommand that passes further args to "rustc"
    // for example `clippy-driver --rustc --version` will print the rustc version that clippy-driver
    // uses
    const pos = orig_args.indexOf("--rustc");
    if (pos >= 0) {
      orig_args.splice(pos, 1);
      orig_args[0] = "rustc"; // PORT: `orig_args[0] = ..` panics (an ICE) on an empty vector; `raw_args` always has the binary name.

      const args = [...orig_args];
      pass_sysroot_env_if_given(args, sys_root_env);

      compiler_entrypoint(args, new DefaultCallbacks());
      return ExitCode.SUCCESS;
    }

    if (orig_args.some((a) => a === "--version" || a === "-V")) {
      const version_info = get_version_info();

      return stdout().lock().write_fmt([version_info, "\n"]).$ === "Ok" ? ExitCode.SUCCESS : ExitCode.FAILURE;
    }

    // Setting RUSTC_WRAPPER causes Cargo to pass 'rustc' as the first argument.
    // We're invoking the compiler programmatically, so we ignore this/
    const arg1 = orig_args[1];
    const wrapper_mode = arg1 !== undefined && file_stem(arg1) === "rustc";

    if (wrapper_mode) {
      // we still want to be able to invoke it normally though
      orig_args.splice(1, 1);
    }

    if (!wrapper_mode && (orig_args.some((a) => a === "--help" || a === "-h") || orig_args.length === 1)) {
      return display_help();
    }

    const args = [...orig_args];
    pass_sysroot_env_if_given(args, sys_root_env);

    let no_deps = false;
    const clippy_args_var = ok(var_("CLIPPY_ARGS"));
    const clippy_args: string[] = [];
    for (const s of (clippy_args_var ?? "").split("__CLIPPY_HACKERY__")) {
      // `.filter_map(|s| match s { .. })`
      if (s === "") {
        continue;
      } else if (s === "--no-deps") {
        no_deps = true;
        continue;
      } else {
        clippy_args.push(s);
      }
    }
    clippy_args.push("--cfg", "clippy"); // `.chain(vec!["--cfg".into(), "clippy".into()])`

    // If no Clippy lints will be run we do not need to run Clippy
    const cap_lints_allow =
      arg_value(orig_args, "--cap-lints", (val) => val === "allow") && !arg_value(orig_args, "--force-warn", (val) => val.includes("clippy::"));

    // If `--no-deps` is enabled only lint the primary package
    const relevant_package = !no_deps || var_("CARGO_PRIMARY_PACKAGE").$ === "Ok";

    // Do not run Clippy for Cargo's info queries so that invalid CLIPPY_ARGS are not cached
    // https://github.com/rust-lang/cargo/issues/14385
    const info_query = args.some((arg) => arg === "-vV") || arg_value(orig_args, "--print", (val) => val !== "crate-root-lint-levels");

    const clippy_enabled = !cap_lints_allow && relevant_package && !info_query;
    if (clippy_enabled) {
      args.push(...clippy_args);
      compiler_entrypoint(args, new ClippyCallbacks(clippy_args_var));
    } else {
      compiler_entrypoint(args, new RustcCallbacks(clippy_args_var));
    }
    return ExitCode.SUCCESS;
  });
}

// #[must_use]
// rustc: src/tools/clippy/src/driver.rs:316 help_message
export function help_message(): string {
  // color_print::cstr!("..."): `<c>`/`<c,bold>` open the SGR codes below, `</>` closes them (39 = default colour, 22 = normal weight).
  return (
    `Checks a file to catch common mistakes and improve your Rust code.
Run ${cyan("clippy-driver")} with the same arguments you use for ${cyan("rustc")}

${green_bold("Usage")}:
    ${cyan_bold("clippy-driver")} ${cyan("[OPTIONS] INPUT")}

${green_bold("Common options:")}
    ${cyan_bold("-h")}, ${cyan_bold("--help")}               Print this message
    ${cyan_bold("-V")}, ${cyan_bold("--version")}            Print version info and exit
    ${cyan_bold("--rustc")}                  Pass all arguments to ${cyan("rustc")}

${green_bold("Allowing / Denying lints")}
You can use tool lints to allow or deny lints from your code, e.g.:

    ${yellow_bold("#[allow(clippy::needless_lifetimes)]")}
`
  );
}

// ---- helpers (rust-ts, not upstream) ----

/** `color_print`'s expansion of `<cyan>..</>` */
function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[39m`;
}
/** `<cyan,bold>..</>` */
function cyan_bold(s: string): string {
  return `\x1b[36m\x1b[1m${s}\x1b[39m\x1b[22m`;
}
/** `<green,bold>..</>` */
function green_bold(s: string): string {
  return `\x1b[32m\x1b[1m${s}\x1b[39m\x1b[22m`;
}
/** `<yellow,bold>..</>` */
function yellow_bold(s: string): string {
  return `\x1b[33m\x1b[1m${s}\x1b[39m\x1b[22m`;
}

/** `rustc_tools_util::get_version_info!()` (PORT: header). */
function get_version_info(): string {
  return unported("rustc_tools_util::get_version_info! (a macro of crate rustc_tools_util, not ported yet)");
}

/** `rustc_driver::catch_with_exit_code::<ExitCode>` (PORT: header). */
function catch_with_exit_code_(f: () => ExitCode): ExitCode {
  let x: ExitCode | undefined;
  const code = catch_with_exit_code(() => {
    x = f();
  });
  return code === EXIT_SUCCESS && x !== undefined ? x : ExitCode.FAILURE;
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

/** `std::fs::read_to_string(path).ok()`: `undefined` when the file cannot be read or is not UTF-8. */
function read_to_string(path: string): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch {
    return undefined;
  }
}

/** `Path::new(p).file_stem()` on a Unix host (PORT: `/` separators only; the root host is macOS, AGENTS.md §5). */
export function file_stem(p: string): string | undefined {
  // `file_name`: the last component if it is a normal one (`.` components after the first are skipped, as `Path::components` does).
  const comps = p.split("/").filter((c, i) => c !== "" && !(c === "." && i > 0));
  const file = comps[comps.length - 1];
  if (file === undefined || file === "." || file === "..") return undefined;
  // `rsplit_file_at_dot(file)` then `before.or(after)`
  const i = file.lastIndexOf(".");
  if (i < 0) return file;
  const before = file.slice(0, i);
  return before.length === 0 ? file : before;
}

// ---- entry glue (rust-ts, not upstream): `fn main() -> ExitCode` as a process, like src/miri/bin/miri.ts ----
// Exit codes: clippy-driver's own, 101 for an ICE, 70 = reached unported code (never a clippy-driver status).
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle's clippy-driver, so a suite must score 100%), `stub`
// (unported, 0%).
if (import.meta.main) {
  try {
    const impl = selected_impl();
    if (impl === "shim") {
      const { DATA } = await import("../../scripts/lib/common.ts");
      const { toolPinsOrDie, toolOracleEnv } = await import("../../scripts/lib/oracle.ts");
      const { toolBinary } = await import("../../scripts/lib/tool-oracles.ts");
      const bin = toolBinary(DATA, toolPinsOrDie().clippy, "clippy", "clippy-driver");
      const proc = Bun.spawn([bin, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, ...toolOracleEnv() } });
      process.exitCode = await proc.exited;
    } else if (impl === "stub") {
      throw new Unported("stub implementation");
    } else {
      ensure_stack();
      process.exitCode = main();
    }
  } catch (e) {
    if (e instanceof Unported) {
      write_stderr(`rust-ts: unported: ${e.what}\n`);
      process.exitCode = 70;
    } else if (e instanceof FatalErrorMarker) {
      process.exitCode = 101;
    } else {
      report_uncaught(e);
      process.exitCode = 101;
    }
  }
}
