// Port of compiler/rustc_driver_impl/src/args.rs.
import { readFileSync } from "node:fs";
import type { EarlyDiagCtxt } from "../rustc_session/session.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { type IoError, display_IoError, io_error_from_node } from "../std/io.ts";
import * as env from "../std/env.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { from_utf8, str_lines } from "../std/str.ts";

/// Expands argfiles in command line arguments.
// #[derive(Default)]
class Expander {
  constructor(
    public shell_argfiles: boolean,
    public next_is_unstable_option: boolean,
    public expanded: string[],
  ) {}

  static default(): Expander {
    return new Expander(false, false, []);
  }

  /// Handles the next argument. If the argument is an argfile, it is expanded
  /// inline.
  // rustc: compiler/rustc_driver_impl/src/args.rs:16 arg
  arg(arg: string): Result<undefined, Error> {
    if (arg.startsWith("@")) {
      const argfile = arg.slice(1);
      const i = argfile.indexOf(":");
      if (i >= 0 && argfile.slice(0, i) === "shell" && this.shell_argfiles) {
        // `shlex::split(&Self::read_file(path)?)`
        const r = Expander.read_file(argfile.slice(i + 1));
        if (r.$ === "Err") return r;
        return unported("shlex::split (-Z shell-argfiles)");
      } else {
        const r = Expander.read_file(argfile);
        if (r.$ === "Err") return r;
        const contents = r._0;
        for (const line of str_lines(contents)) this.push(line);
      }
    } else {
      this.push(arg);
    }

    return Ok(undefined);
  }

  /// Adds a command line argument verbatim with no argfile expansion.
  // rustc: compiler/rustc_driver_impl/src/args.rs:38 push
  push(arg: string): void {
    // Unfortunately, we have to do some eager argparsing to handle unstable
    // options which change the behavior of argfile arguments.
    //
    // Normally, all of the argfile arguments (e.g. `@args.txt`) are
    // expanded into our arguments list *and then* the whole list of
    // arguments are passed on to be parsed. However, argfile parsing
    // options like `-Zshell_argfiles` need to change the behavior of that
    // argument expansion. So we have to do a little parsing on our own here
    // instead of leaning on the existing logic.
    //
    // All we care about are unstable options, so we parse those out and
    // look for any that affect how we expand argfiles. This argument
    // inspection is very conservative; we only change behavior when we see
    // exactly the options we're looking for and everything gets passed
    // through.

    if (this.next_is_unstable_option) {
      this.inspect_unstable_option(arg);
      this.next_is_unstable_option = false;
    } else if (arg.startsWith("-Z")) {
      const unstable_option = arg.slice(2);
      if (unstable_option.length === 0) {
        this.next_is_unstable_option = true;
      } else {
        this.inspect_unstable_option(unstable_option);
      }
    }

    this.expanded.push(arg);
  }

  /// Consumes the `Expander`, returning the expanded arguments.
  // rustc: compiler/rustc_driver_impl/src/args.rs:70 finish
  finish(): string[] {
    return this.expanded;
  }

  /// Parses any relevant unstable flags specified on the command line.
  // rustc: compiler/rustc_driver_impl/src/args.rs:75 inspect_unstable_option
  inspect_unstable_option(option: string): void {
    switch (option) {
      case "shell-argfiles":
        this.shell_argfiles = true;
        break;
      default:
        break;
    }
  }

  /// Reads the contents of a file as UTF-8.
  // rustc: compiler/rustc_driver_impl/src/args.rs:83 read_file
  static read_file(path: string): Result<string, Error> {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(path);
    } catch (e) {
      return Err({ $: "IOError", _0: path, _1: io_error_from_node(e) });
    }
    const s = from_utf8(bytes);
    if (s.$ === "Err") {
      // `e.kind() == io::ErrorKind::InvalidData`
      return Err({ $: "Utf8Error", _0: path });
    }
    // A leading U+FEFF is kept (`read_to_string` does not strip a BOM).
    return Ok(s._0);
  }
}

/// Replaces any `@file` arguments with the contents of `file`, with each line of `file` as a
/// separate argument.
///
/// **Note:** This function doesn't interpret argument 0 in any special way.
/// If this function is intended to be used with command line arguments,
/// `argv[0]` must be removed prior to calling it manually.
// rustc: compiler/rustc_driver_impl/src/args.rs:100 arg_expand_all
export function arg_expand_all(early_dcx: EarlyDiagCtxt, at_args: readonly string[]): string[] {
  const expander = Expander.default();
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);
  for (const arg of at_args) {
    const r = expander.arg(arg);
    if (r.$ === "Err") {
      result = Err(early_dcx.early_err(`failed to load argument file: ${display_Error(r._0)}`));
    }
  }
  if (result.$ === "Err") {
    result._0.raise_fatal();
  }
  return expander.finish();
}

/// Gets the raw unprocessed command-line arguments as Unicode strings, without doing any further
/// processing (e.g., without `@file` expansion).
///
/// This function is identical to [`env::args()`] except that it emits an error when it encounters
/// non-Unicode arguments instead of panicking.
// rustc: compiler/rustc_driver_impl/src/args.rs:119 raw_args
export function raw_args(early_dcx: EarlyDiagCtxt): string[] {
  const args: string[] = [];
  let guar: Result<undefined, ErrorGuaranteed> = Ok(undefined);
  const args_os = env.args_os();
  for (let i = 0; i < args_os.length; i++) {
    const r = env.os_string_into_string(args_os[i]!);
    switch (r.$) {
      case "Ok":
        args.push(r._0);
        break;
      case "Err":
        guar = Err(early_dcx.early_err(`argument ${i} is not valid Unicode: ${env.debug_os_string(r._0)}`));
        break;
    }
  }
  if (guar.$ === "Err") {
    guar._0.raise_fatal();
  }
  return args;
}

// #[derive(Debug)]
type Error =
  | { readonly $: "Utf8Error"; readonly _0: string }
  | { readonly $: "IOError"; readonly _0: string; readonly _1: IoError }
  | { readonly $: "ShellParseError"; readonly _0: string };

// rustc: compiler/rustc_driver_impl/src/args.rs:145 fmt
function display_Error(self: Error): string {
  switch (self.$) {
    case "Utf8Error":
      return `UTF-8 error in ${self._0}`;
    case "IOError":
      return `IO error: ${self._0}: ${display_IoError(self._1)}`;
    case "ShellParseError":
      return `invalid shell-style arguments in ${self._0}`;
  }
}
