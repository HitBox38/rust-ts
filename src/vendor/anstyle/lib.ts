// Port of anstyle =1.0.13 `src/lib.rs` (default features, i.e. with `std`).
//
//! ANSI Text Styling
//!
//! *A portmanteau of "ansi style"*
//!
//! `anstyle` provides core types describing [ANSI styling escape
//! codes](https://en.wikipedia.org/wiki/ANSI_escape_code) for interoperability
//! between crates.
//!
//! Example use cases:
//! - An argument parser allowing callers to define the colors used in the help-output without
//!   putting the text formatting crate in the public API
//! - A style description parser that can work with any text formatting crate
//!
//! Priorities:
//! 1. API stability
//! 2. Low compile-time and binary-size overhead
//! 3. `const` friendly API for callers to statically define their stylesheet
//!
//! (The list of integration crates in upstream's crate docs is not repeated here.)
//!
//! # Examples
//!
//! The core type is [`Style`]:
//! ```rust
//! let style = anstyle::Style::new().bold();
//! ```
//
// PORT: crate-wide conventions of this port (see docs/handoff/annotate-a.md):
// - `impl Display for T` → a `fmt(f: Fmt): string` function returning what the impl writes
//   (writing to a formatter cannot fail here, so `fmt::Result` is dropped). `Fmt` is the
//   `{alternate}` flag record from src/std/fmt.ts; `{x:#}` passes `PRETTY`, `{x}` passes `PLAIN`.
// - Methods returning `impl Display + Copy` (`render*`) return the rendered `string`. Every such
//   value upstream ignores all formatter flags (see the `no_align` tests), so rendering eagerly
//   is observably the same.
// - `macros.rs` (`escape!`, a `concat!` wrapper) has no functions; its expansions are written out
//   as string literals with the macro call in a comment.
// - `&mut dyn std::io::Write` → the `Write` interface below (only `write_all` is used).

export * from "./color.ts";
export * from "./effect.ts";
export * from "./reset.ts";
export * from "./style.ts";

import type { Result } from "../../std/result.ts";

/** `std::io::Write`, reduced to the one method anstyle calls. `std::io::Error` stays opaque. */
export interface Write {
  write_all(buf: Uint8Array): Result<undefined, unknown>;
}
