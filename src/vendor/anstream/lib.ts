// Port of anstream =0.6.21 `src/lib.rs` (default features `auto` + `wincon`, non-windows host).
//
//! **Auto-adapting [`stdout`] / [`stderr`] streams**
//!
//! *A portmanteau of "ansi stream"*
//!
//! [`AutoStream`] always accepts [ANSI escape codes](https://en.wikipedia.org/wiki/ANSI_escape_code),
//! [adapting to the user's terminal's capabilities][AutoStream].
//!
//! Benefits
//! - Allows the caller to not be concerned with the terminal's capabilities
//! - Semver safe way of passing styled text between crates as ANSI escape codes offer more
//!   compatibility than most crate APIs.
//!
//! Available styling crates:
//! - [anstyle](https://docs.rs/anstyle) for minimal runtime styling, designed to go in public APIs
//! - [owo-colors](https://docs.rs/owo-colors) for feature-rich runtime styling
//! - [color-print](https://docs.rs/color-print) for feature-rich compile-time styling
//!
//! # Example
//!
//! ```
//! #  #[cfg(feature = "auto")] {
//! use anstream::println;
//! use owo_colors::OwoColorize as _;
//!
//! // Foreground colors
//! println!("My number is {:#x}!", 10.green());
//! // Background colors
//! println!("My number is not {}!", 4.on_red());
//! # }
//! ```
//!
//! And this will correctly handle piping to a file, etc
//
// PORT: rust-ts follows non-windows host semantics (`cfg!(windows)` is false), so the
// `#[cfg(all(windows, feature = "wincon"))]` `wincon` module (`WinconStream`, Windows console API
// through `anstyle-wincon`) is not ported:
// crate-skip: anstream-0.6.21/src/wincon.rs:25 new windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:34 into_inner windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:40 as_inner windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:52 is_terminal windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:64 lock windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:79 lock windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:94 write windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:98 write_vectored windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:108 flush windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:112 write_all windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:117 write_fmt windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:122 write windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:140 write_all windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:166 write_fmt windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:175 cap_wincon_color windows-only (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:192 write_all_no_escapes windows-only test (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:203 write_byte_no_escapes windows-only test (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:216 write_all_random windows-only test (cfg(all(windows, feature = "wincon")))
// crate-skip: anstream-0.6.21/src/wincon.rs:224 write_byte_random windows-only test (cfg(all(windows, feature = "wincon")))
// `buffer.rs` is the deprecated `Buffer` (unused by rustc):
// crate-skip: anstream-0.6.21/src/buffer.rs:11 new deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:16 with_capacity deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:21 as_bytes deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:28 as_ref deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:35 write deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:41 flush deprecated Buffer (buffer.rs)
// crate-skip: anstream-0.6.21/src/buffer.rs:48 write_colored deprecated Buffer, windows-only (buffer.rs)
// `_macros.rs` holds the `print!`-family macros; rustc does not use them:
// crate-skip: anstream-0.6.21/src/_macros.rs:349 to_adapted_string helper of the print!/panic! macros (unused by rustc)
// Examples are binaries, not library code:
// crate-skip: anstream-0.6.21/examples/dump-stream.rs:5 main example binary, not library code
// crate-skip: anstream-0.6.21/examples/dump-stream.rs:44 style example binary, not library code
// crate-skip: anstream-0.6.21/examples/dump-stream.rs:57 print_number example binary, not library code
// crate-skip: anstream-0.6.21/examples/dump-stream.rs:76 parse example binary, not library code
// crate-skip: anstream-0.6.21/examples/query-stream.rs:3 main example binary, not library code

import { AutoStream } from "./auto.ts";
import { stderr as std_stderr, stdout as std_stdout, type Stderr as StdStderr, type Stdout as StdStdout } from "./stream.ts";

export * as adapter from "./adapter/mod.ts";
export * as stream from "./stream.ts";

export { AutoStream } from "./auto.ts";
export { StripStream } from "./strip.ts";

/// An adaptive wrapper around the global standard output stream of the current process
export type Stdout = AutoStream<StdStdout>;
/// An adaptive wrapper around the global standard error stream of the current process
export type Stderr = AutoStream<StdStderr>;

/// Create an ANSI escape code compatible stdout
///
/// **Note:** Call [`AutoStream::lock`] in loops to avoid the performance hit of acquiring/releasing
/// from the implicit locking in each [`std::io::Write`] call
// crate: anstream-0.6.21/src/lib.rs:70 stdout
export function stdout(): Stdout {
  const stdout = std_stdout();
  return AutoStream.auto(stdout);
}

/// Create an ANSI escape code compatible stderr
///
/// **Note:** Call [`AutoStream::lock`] in loops to avoid the performance hit of acquiring/releasing
/// from the implicit locking in each [`std::io::Write`] call
// crate: anstream-0.6.21/src/lib.rs:80 stderr
export function stderr(): Stderr {
  const stderr = std_stderr();
  return AutoStream.auto(stderr);
}

/// Selection for overriding color output
export { ColorChoice } from "../colorchoice/lib.ts";
