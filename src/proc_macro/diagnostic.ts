// Port of library/proc_macro/src/diagnostic.rs (subset: `Level`).
//
// PORT: `proc_macro` is a library crate (`compiler/rustc_proc_macro` builds `library/proc_macro`), so it is
// ported like `src/std/` with `// std:` markers pointing at `library/proc_macro/src/...` (coverage.ts only counts
// `compiler/` files). Only the types the server side (`rustc_expand::proc_macro_server`) names are ported in M2;
// the client-side `Diagnostic` builder API (`Span::error(..)`, `Diagnostic::emit`, `MultiSpan`) runs inside the
// proc-macro dylib and is M6 (decision D6).

import type { Debug } from "../std/fmt.ts";

/// An enum representing a diagnostic level.
// std-type: library/proc_macro/src/diagnostic.rs:7 Level
// PORT: `#[non_exhaustive]` has no TS counterpart; matches over `Level` keep their `_ =>` arms.
export type Level =
  /// An error.
  | "Error"
  /// A warning.
  | "Warning"
  /// A note.
  | "Note"
  /// A help message.
  | "Help";
export const Level = { Error: "Error", Warning: "Warning", Note: "Note", Help: "Help" } as const;
/** `#[derive(Debug)]` */
export const debug_Level: Debug<Level> = (v) => v;
