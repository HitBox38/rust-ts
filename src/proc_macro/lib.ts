// Port of library/proc_macro/src/lib.rs (subset: the types the compiler-side bridge server names).
//
// PORT: see diagnostic.ts for the layout and marker conventions of this library port. The public client API
// (`TokenStream`, `Group`, `Punct`, `Ident`, `Literal`, `Span` handles talking to the bridge) only exists inside a
// proc-macro dylib and is M6 (decision D6). Extension modules are imported for their side effects (PORTING §5):
// bridge/server.ts attaches `Client::run1` / `Client::run2` to bridge/client.ts's class.

import type { Debug } from "../std/fmt.ts";

import "./bridge/mod.ts";
import "./bridge/client.ts";
import "./bridge/server.ts";

// pub mod bridge;
export * as bridge from "./bridge/mod.ts";
// pub use diagnostic::{Diagnostic, Level, MultiSpan};
export { debug_Level, Level } from "./diagnostic.ts";

/// Describes how a sequence of token trees is delimited.
// std-type: library/proc_macro/src/lib.rs:913 Delimiter
export type Delimiter =
  /// `( ... )`
  | "Parenthesis"
  /// `{ ... }`
  | "Brace"
  /// `[ ... ]`
  | "Bracket"
  /// `∅ ... ∅`
  /// An invisible delimiter, that may, for example, appear around tokens coming from a
  /// "macro variable" `$var`. It is important to preserve operator priorities in cases like
  /// `$var * 3` where `$var` is `1 + 2`.
  /// Invisible delimiters might not survive roundtrip of a token stream through a string.
  ///
  /// <div class="warning">
  ///
  /// Note: rustc currently can ignore the grouping of tokens delimited by `None` in the output
  /// of a proc_macro. Only `None`-delimited groups created by a macro_rules macro in the input
  /// of a proc_macro macro are preserved, and only in very specific circumstances.
  /// Any `None`-delimited groups (re)created by a proc_macro will therefore not preserve
  /// operator priorities as indicated above. The other `Delimiter` variants should be used
  /// instead in this context. This is a rustc bug. For details, see
  /// [rust-lang/rust#67062](https://github.com/rust-lang/rust/issues/67062).
  ///
  /// </div>
  | "None";
export const Delimiter = { Parenthesis: "Parenthesis", Brace: "Brace", Bracket: "Bracket", None: "None" } as const;
/** `#[derive(Debug)]` */
export const debug_Delimiter: Debug<Delimiter> = (v) => v;
