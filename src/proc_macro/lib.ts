// Port of library/proc_macro/src/lib.rs.
//
//! A support library for macro authors when defining new macros.
//!
//! This library, provided by the standard distribution, provides the types
//! consumed in the interfaces of procedurally defined macro definitions such as
//! function-like macros `#[proc_macro]`, macro attributes `#[proc_macro_attribute]` and
//! custom derive attributes `#[proc_macro_derive]`.
//!
//! See [the book] for more.
//!
//! [the book]: ../book/ch19-06-macros.html#procedural-macros-for-generating-code-from-attributes
//
// PORT: `proc_macro` is a library crate, ported like `src/std/` with `// std:` markers pointing at
// `library/proc_macro/src/...` (decision 2026-10-13; coverage.ts only counts `// rustc:` markers). This is the
// *client* half (plan-m6 D8): the public API a proc macro uses, talking to the server through
// `bridge::client`. In rust-ts it runs in-process for the builtin `quote!` client
// (`Client::expand1(quote)`, rustc_builtin_macros).
// - Rust `Drop` of client handles (`TokenStream`'s `Methods::ts_drop`) is not modelled: values the client
//   drops stay in the server's handle store until the expansion's store is dropped. Handles are never reused
//   (`OwnedStore` counters only grow), so nothing observable changes.
// - Moves are kept: a `TokenStream`/`Group` moved into the bridge is never used again here (the server takes
//   owned handles out of its store).
// - `Display` impls are `to_string()` methods (or `<Type>.to_string(v)` on enum companions), `Debug` impls are
//   `debug_<Type>` functions. Trait impls with several targets (`From`, `FromIterator`, `Extend`) get one method
//   per impl, suffixed with the source type.
// - Extension modules are imported for their side effects (PORTING §5): bridge/server.ts attaches
//   `Client::run1` / `Client::run2` to bridge/client.ts's class.

import {
  type Debug,
  debug_char,
  debug_list,
  debug_option,
  debug_str,
  debug_struct,
  debug_tuple,
  display_f64 as display_f64_std,
  PLAIN,
} from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str, utf8 } from "../std/str.ts";
import {
  EscapeError as EE,
  type MixedUnit,
  unescape_byte,
  unescape_byte_str,
  unescape_c_str,
  unescape_char,
  unescape_str,
} from "../vendor/rustc_literal_escaper/lib.ts";
import {
  type Diagnostic as BridgeDiagnostic,
  DelimSpan,
  type Group as BridgeGroup,
  type Ident as BridgeIdent,
  IdentKind,
  LitKind,
  LitKind_eq,
  type Literal as BridgeLiteral,
  type Punct as BridgePunct,
  type TokenTree as BridgeTokenTree,
  debug_LitKind,
} from "./bridge/mod.ts";
import type { Bound, Range } from "./bridge/server.ts";
import { Diagnostic, Level } from "./diagnostic.ts";
import { escape_bytes, type EscapeOptions } from "./escape.ts";

import "./bridge/mod.ts";
import "./bridge/client.ts";
import "./bridge/server.ts";

// ---------------------------------------------------------------------------------------------------------------
// PORT(contract): pending pm-bridge. bridge/client.rs's client-side handles, `Methods` and `is_available`, and
// bridge/symbol.rs's `Symbol` (re-exported by client.rs), declared with the shapes agreed with pm-bridge until its
// bridge/client.ts / bridge/symbol.ts land. At merge: delete this block and import
// `{ TokenStream as client_TokenStream, Span as client_Span, Symbol as client_Symbol, Methods as BridgeMethods,
// is_available as client_is_available, debug_Span as debug_client_Span, debug_Symbol as debug_client_Symbol,
// display_Symbol as display_client_Symbol }` from "./bridge/client.ts" (upstream `use crate::bridge::client::...`),
// and register `crate_TokenStream.new_ = (x) => new TokenStream(x)` (pm-bridge's hook for client.rs:48-60).
// Everything below calls `unported(..)` until then.

/** `bridge::client::Span` (client.rs:63, `#[derive(Copy, Clone, PartialEq, Eq, Hash)] struct Span { handle }`). */
export type client_Span = number & { readonly __brand: "proc_macro::bridge::client::Span" };
export const client_Span = {
  def_site(): client_Span {
    return unported("proc_macro::bridge::client::Span::def_site (pending pm-bridge)");
  },
  call_site(): client_Span {
    return unported("proc_macro::bridge::client::Span::call_site (pending pm-bridge)");
  },
  mixed_site(): client_Span {
    return unported("proc_macro::bridge::client::Span::mixed_site (pending pm-bridge)");
  },
};
/** `impl fmt::Debug for bridge::client::Span` (client.rs:103): `Methods::span_debug(*self)`. */
export const debug_client_Span: Debug<client_Span> = (v) => BridgeMethods.span_debug(v);

/** `bridge::client::TokenStream` (client.rs:13, `struct TokenStream { handle }`; `Clone` = `Methods::ts_clone`). */
export class client_TokenStream {
  constructor(public handle: number) {}

  /** `impl Clone for TokenStream` (client.rs:85) */
  clone(): client_TokenStream {
    return BridgeMethods.ts_clone(this);
  }
}

/** `bridge::symbol::Symbol` (symbol.rs:19, `struct Symbol(NonZero<u32>)`). */
export type client_Symbol = number & { readonly __brand: "proc_macro::bridge::client::Symbol" };
export const client_Symbol = {
  new(_string: string): client_Symbol {
    return unported("proc_macro::bridge::symbol::Symbol::new (pending pm-bridge)");
  },
  new_ident(_string: string, _is_raw: boolean): client_Symbol {
    return unported("proc_macro::bridge::symbol::Symbol::new_ident (pending pm-bridge)");
  },
  with<R>(_self: client_Symbol, _f: (s: string) => R): R {
    return unported("proc_macro::bridge::symbol::Symbol::with (pending pm-bridge)");
  },
};
/** `impl fmt::Debug for Symbol` (symbol.rs:85) */
export const debug_client_Symbol: Debug<client_Symbol> = (v) => client_Symbol.with(v, (s) => debug_str(s));
/** `impl fmt::Display for Symbol` (symbol.rs:91) */
export const display_client_Symbol = (v: client_Symbol): string => client_Symbol.with(v, (s) => s);

type ClientTree = BridgeTokenTree<client_TokenStream, client_Span, client_Symbol>;

/** `with_api!(define_client_side, TokenStream, Span, Symbol)` (client.rs:110; the list is bridge/mod.rs:33). */
export interface ClientMethods {
  track_env_var(var_: string, value: string | undefined): void;
  track_path(path: string): void;
  literal_from_str(s: string): Result<BridgeLiteral<client_Span, client_Symbol>, string>;
  emit_diagnostic(diagnostic: BridgeDiagnostic<client_Span>): void;

  ts_drop(stream: client_TokenStream): void;
  ts_clone(stream: client_TokenStream): client_TokenStream;
  ts_is_empty(stream: client_TokenStream): boolean;
  ts_expand_expr(stream: client_TokenStream): Result<client_TokenStream, undefined>;
  ts_from_str(src: string): Result<client_TokenStream, string>;
  ts_to_string(stream: client_TokenStream): string;
  ts_from_token_tree(tree: ClientTree): client_TokenStream;
  ts_concat_trees(base: client_TokenStream | undefined, trees: ClientTree[]): client_TokenStream;
  ts_concat_streams(base: client_TokenStream | undefined, streams: client_TokenStream[]): client_TokenStream;
  ts_into_trees(stream: client_TokenStream): ClientTree[];

  span_debug(span: client_Span): string;
  span_parent(span: client_Span): client_Span | undefined;
  span_source(span: client_Span): client_Span;
  span_byte_range(span: client_Span): Range;
  span_start(span: client_Span): client_Span;
  span_end(span: client_Span): client_Span;
  span_line(span: client_Span): number;
  span_column(span: client_Span): number;
  span_file(span: client_Span): string;
  span_local_file(span: client_Span): string | undefined;
  span_join(span: client_Span, other: client_Span): client_Span | undefined;
  span_subspan(span: client_Span, start: Bound, end: Bound): client_Span | undefined;
  span_resolved_at(span: client_Span, at: client_Span): client_Span;
  span_source_text(span: client_Span): string | undefined;
  span_save_span(span: client_Span): number;
  span_recover_proc_macro_span(id: number): client_Span;

  symbol_normalize_and_validate_ident(string: string): Result<client_Symbol, undefined>;
}
const CLIENT_METHOD_NAMES: readonly (keyof ClientMethods)[] = [
  "track_env_var",
  "track_path",
  "literal_from_str",
  "emit_diagnostic",
  "ts_drop",
  "ts_clone",
  "ts_is_empty",
  "ts_expand_expr",
  "ts_from_str",
  "ts_to_string",
  "ts_from_token_tree",
  "ts_concat_trees",
  "ts_concat_streams",
  "ts_into_trees",
  "span_debug",
  "span_parent",
  "span_source",
  "span_byte_range",
  "span_start",
  "span_end",
  "span_line",
  "span_column",
  "span_file",
  "span_local_file",
  "span_join",
  "span_subspan",
  "span_resolved_at",
  "span_source_text",
  "span_save_span",
  "span_recover_proc_macro_span",
  "symbol_normalize_and_validate_ident",
];
/** `bridge::client::Methods` (`use crate::bridge::client::Methods as BridgeMethods;`). */
export const BridgeMethods: ClientMethods = Object.fromEntries(
  CLIENT_METHOD_NAMES.map((name) => [
    name,
    () => unported(`proc_macro::bridge::client::Methods::${name} (pending pm-bridge)`),
  ]),
) as unknown as ClientMethods;
/** `bridge::client::is_available` (client.rs:206) */
export function client_is_available(): boolean {
  return unported("proc_macro::bridge::client::is_available (pending pm-bridge)");
}
// End of PORT(contract) block.
// ---------------------------------------------------------------------------------------------------------------

// pub mod bridge;
export * as bridge from "./bridge/mod.ts";

// pub use diagnostic::{Diagnostic, Level, MultiSpan};
export { debug_Diagnostic, debug_Level, Diagnostic, Level, MultiSpan } from "./diagnostic.ts";
// pub use to_tokens::ToTokens;
export { type ToTokens } from "./to_tokens.ts";

/// Mostly relating to malformed escape sequences, but also a few other problems.
// std-type: library/proc_macro/src/lib.rs:71 EscapeError
// PORT: `#[non_exhaustive]`; same variant set as rustc_literal_escaper's, but a distinct type.
export type EscapeError =
  /// Expected 1 char, but 0 were found.
  | "ZeroChars"
  /// Expected 1 char, but more than 1 were found.
  | "MoreThanOneChar"
  /// Escaped '\' character without continuation.
  | "LoneSlash"
  /// Invalid escape character (e.g. '\z').
  | "InvalidEscape"
  /// Raw '\r' encountered.
  | "BareCarriageReturn"
  /// Raw '\r' encountered in raw string.
  | "BareCarriageReturnInRawString"
  /// Unescaped character that was expected to be escaped (e.g. raw '\t').
  | "EscapeOnlyChar"
  /// Numeric character escape is too short (e.g. '\x1').
  | "TooShortHexEscape"
  /// Invalid character in numeric escape (e.g. '\xz')
  | "InvalidCharInHexEscape"
  /// Character code in numeric escape is non-ascii (e.g. '\xFF').
  | "OutOfRangeHexEscape"
  /// '\u' not followed by '{'.
  | "NoBraceInUnicodeEscape"
  /// Non-hexadecimal value in '\u{..}'.
  | "InvalidCharInUnicodeEscape"
  /// '\u{}'
  | "EmptyUnicodeEscape"
  /// No closing brace in '\u{..}', e.g. '\u{12'.
  | "UnclosedUnicodeEscape"
  /// '\u{_12}'
  | "LeadingUnderscoreUnicodeEscape"
  /// More than 6 characters in '\u{..}', e.g. '\u{10FFFF_FF}'
  | "OverlongUnicodeEscape"
  /// Invalid in-bound unicode character code, e.g. '\u{DFFF}'.
  | "LoneSurrogateUnicodeEscape"
  /// Out of bounds unicode character code, e.g. '\u{FFFFFF}'.
  | "OutOfRangeUnicodeEscape"
  /// Unicode escape code in byte literal.
  | "UnicodeEscapeInByte"
  /// Non-ascii character in byte literal, byte string literal, or raw byte string literal.
  | "NonAsciiCharInByte"
  /// `\0` in a C string literal.
  | "NulInCStr"
  /// After a line ending with '\', the next line contains whitespace
  /// characters that are not skipped.
  | "UnskippedWhitespaceWarning"
  /// After a line ending with '\', multiple lines are skipped.
  | "MultipleSkippedLinesWarning";
export const EscapeError = {
  // std: library/proc_macro/src/lib.rs:131 from
  from(value: EE): EscapeError {
    switch (value) {
      case "ZeroChars":
        return "ZeroChars";
      case "MoreThanOneChar":
        return "MoreThanOneChar";
      case "LoneSlash":
        return "LoneSlash";
      case "InvalidEscape":
        return "InvalidEscape";
      case "BareCarriageReturn":
        return "BareCarriageReturn";
      case "BareCarriageReturnInRawString":
        return "BareCarriageReturnInRawString";
      case "EscapeOnlyChar":
        return "EscapeOnlyChar";
      case "TooShortHexEscape":
        return "TooShortHexEscape";
      case "InvalidCharInHexEscape":
        return "InvalidCharInHexEscape";
      case "OutOfRangeHexEscape":
        return "OutOfRangeHexEscape";
      case "NoBraceInUnicodeEscape":
        return "NoBraceInUnicodeEscape";
      case "InvalidCharInUnicodeEscape":
        return "InvalidCharInUnicodeEscape";
      case "EmptyUnicodeEscape":
        return "EmptyUnicodeEscape";
      case "UnclosedUnicodeEscape":
        return "UnclosedUnicodeEscape";
      case "LeadingUnderscoreUnicodeEscape":
        return "LeadingUnderscoreUnicodeEscape";
      case "OverlongUnicodeEscape":
        return "OverlongUnicodeEscape";
      case "LoneSurrogateUnicodeEscape":
        return "LoneSurrogateUnicodeEscape";
      case "OutOfRangeUnicodeEscape":
        return "OutOfRangeUnicodeEscape";
      case "UnicodeEscapeInByte":
        return "UnicodeEscapeInByte";
      case "NonAsciiCharInByte":
        return "NonAsciiCharInByte";
      case "NulInCStr":
        return "NulInCStr";
      case "UnskippedWhitespaceWarning":
        return "UnskippedWhitespaceWarning";
      case "MultipleSkippedLinesWarning":
        return "MultipleSkippedLinesWarning";
    }
  },

  // std: library/proc_macro/src/lib.rs:167 fmt
  to_string(self: EscapeError): string {
    switch (self) {
      case "ZeroChars":
        return "zero chars";
      case "MoreThanOneChar":
        return "more than one char";
      case "LoneSlash":
        return "lone slash";
      case "InvalidEscape":
        return "invalid escape";
      case "BareCarriageReturn":
        return "bare carriage return";
      case "BareCarriageReturnInRawString":
        return "bare carriage return in raw string";
      case "EscapeOnlyChar":
        return "escape only char";
      case "TooShortHexEscape":
        return "too short hex escape";
      case "InvalidCharInHexEscape":
        return "invalid char in hex escape";
      case "OutOfRangeHexEscape":
        return "out of range hex escape";
      case "NoBraceInUnicodeEscape":
        return "no brace in unicode escape";
      case "InvalidCharInUnicodeEscape":
        return "invalid char in unicode escape";
      case "EmptyUnicodeEscape":
        return "empty unicode escape";
      case "UnclosedUnicodeEscape":
        return "unclosed unicode escape";
      case "LeadingUnderscoreUnicodeEscape":
        return "leading underscore unicode escape";
      case "OverlongUnicodeEscape":
        return "overlong unicode escape";
      case "LoneSurrogateUnicodeEscape":
        return "lone surrogate unicode escape";
      case "OutOfRangeUnicodeEscape":
        return "out of range unicode escape";
      case "UnicodeEscapeInByte":
        return "unicode escape in byte";
      case "NonAsciiCharInByte":
        return "non ascii char in byte";
      case "NulInCStr":
        return "nul in CStr";
      case "UnskippedWhitespaceWarning":
        return "unskipped whitespace warning";
      case "MultipleSkippedLinesWarning":
        return "multiple skipped lines warning";
    }
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_EscapeError: Debug<EscapeError> = (v) => v;

/// Errors returned when trying to retrieve a literal unescaped value.
// std-type: library/proc_macro/src/lib.rs:200 ConversionErrorKind
export type ConversionErrorKind =
  /// The literal failed to be escaped, take a look at [`EscapeError`] for more information.
  | { readonly $: "FailedToUnescape"; readonly _0: EscapeError }
  /// Trying to convert a literal with the wrong type.
  | { readonly $: "InvalidLiteralKind" };
export const ConversionErrorKind = {
  InvalidLiteralKind: Object.freeze({ $: "InvalidLiteralKind" as const }),
};
/** `#[derive(Debug)]` */
export const debug_ConversionErrorKind: Debug<ConversionErrorKind> = (v, f) =>
  v.$ === "FailedToUnescape" ? debug_tuple(f, "FailedToUnescape", [debug_EscapeError(v._0, f)]) : v.$;

/// Determines whether proc_macro has been made accessible to the currently
/// running program.
///
/// The proc_macro crate is only intended for use inside the implementation of
/// procedural macros. All the functions in this crate panic if invoked from
/// outside of a procedural macro, such as from a build script or unit test or
/// ordinary Rust binary.
///
/// With consideration for Rust libraries that are designed to support both
/// macro and non-macro use cases, `proc_macro::is_available()` provides a
/// non-panicking way to detect whether the infrastructure required to use the
/// API of proc_macro is presently available. Returns true if invoked from
/// inside of a procedural macro, false if invoked from any other binary.
// std: library/proc_macro/src/lib.rs:221 is_available
export function is_available(): boolean {
  return client_is_available();
}

/// The main type provided by this crate, representing an abstract stream of
/// tokens, or, more specifically, a sequence of token trees.
/// The type provides interfaces for iterating over those token trees and, conversely,
/// collecting a number of token trees into one stream.
///
/// This is both the input and output of `#[proc_macro]`, `#[proc_macro_attribute]`
/// and `#[proc_macro_derive]` definitions.
// std-type: library/proc_macro/src/lib.rs:235 TokenStream
export class TokenStream {
  constructor(public _0: client_TokenStream | undefined) {}

  /** `#[derive(Clone)]` */
  clone(): TokenStream {
    return new TokenStream(this._0 === undefined ? undefined : this._0.clone());
  }

  /// Returns an empty `TokenStream` containing no token trees.
  // std: library/proc_macro/src/lib.rs:290 new
  static new(): TokenStream {
    return new TokenStream(undefined);
  }

  /// Checks if this `TokenStream` is empty.
  // std: library/proc_macro/src/lib.rs:296 is_empty
  is_empty(): boolean {
    return this._0 === undefined ? true : BridgeMethods.ts_is_empty(this._0);
  }

  /// Parses this `TokenStream` as an expression and attempts to expand any
  /// macros within it. Returns the expanded `TokenStream`.
  ///
  /// Currently only expressions expanding to literals will succeed, although
  /// this may be relaxed in the future.
  ///
  /// NOTE: In error conditions, `expand_expr` may leave macros unexpanded,
  /// report an error, failing compilation, and/or return an `Err(..)`. The
  /// specific behavior for any error condition, and what conditions are
  /// considered errors, is unspecified and may change in the future.
  // std: library/proc_macro/src/lib.rs:311 expand_expr
  expand_expr(): Result<TokenStream, ExpandError> {
    const stream = this._0;
    if (stream === undefined) return Err(ExpandError.INSTANCE);
    const r = BridgeMethods.ts_expand_expr(stream);
    if (r.$ === "Ok") return Ok(new TokenStream(r._0));
    return Err(ExpandError.INSTANCE);
  }

  /// Attempts to break the string into tokens and parse those tokens into a token stream.
  /// May fail for a number of reasons, for example, if the string contains unbalanced delimiters
  /// or characters not existing in the language.
  /// All tokens in the parsed stream get `Span::call_site()` spans.
  ///
  /// NOTE: some errors may cause panics instead of returning `LexError`. We reserve the right to
  /// change these errors into `LexError`s later.
  // std: library/proc_macro/src/lib.rs:331 from_str
  static from_str(src: string): Result<TokenStream, LexError> {
    const r = BridgeMethods.ts_from_str(src);
    if (r.$ === "Err") return Err(new LexError(r._0));
    return Ok(new TokenStream(r._0));
  }

  /// Prints the token stream as a string that is supposed to be losslessly convertible back
  /// into the same token stream (modulo spans), except for possibly `TokenTree::Group`s
  /// with `Delimiter::None` delimiters and negative numeric literals.
  ///
  /// Note: the exact form of the output is subject to change, e.g. there might
  /// be changes in the whitespace used between tokens. Therefore, you should
  /// *not* do any kind of simple substring matching on the output string (as
  /// produced by `to_string`) to implement a proc macro, because that matching
  /// might stop working if such changes happen. Instead, you should work at the
  /// `TokenTree` level, e.g. matching against `TokenTree::Ident`,
  /// `TokenTree::Punct`, or `TokenTree::Literal`.
  // std: library/proc_macro/src/lib.rs:349 fmt
  to_string(): string {
    const ts = this._0;
    if (ts !== undefined) return BridgeMethods.ts_to_string(ts);
    return "";
  }

  // std: library/proc_macro/src/lib.rs:368 default
  static default_(): TokenStream {
    return TokenStream.new();
  }

  /// Creates a token stream containing a single token tree.
  // std: library/proc_macro/src/lib.rs:390 from
  static from_TokenTree(tree: TokenTree): TokenStream {
    return new TokenStream(BridgeMethods.ts_from_token_tree(tree_to_bridge_tree(tree)));
  }

  /// Collects a number of token trees into a single stream.
  // std: library/proc_macro/src/lib.rs:473 from_iter
  // PORT: `iter.size_hint().0` only sizes the helper's `Vec`; TS arrays need no capacity.
  static from_iter_TokenTree(trees: Iterable<TokenTree>): TokenStream {
    const builder = ConcatTreesHelper.new(0);
    for (const tree of trees) builder.push(tree);
    return builder.build();
  }

  /// A "flattening" operation on token streams, collects token trees
  /// from multiple token streams into a single stream.
  // std: library/proc_macro/src/lib.rs:485 from_iter
  static from_iter_TokenStream(streams: Iterable<TokenStream>): TokenStream {
    const builder = ConcatStreamsHelper.new(0);
    for (const stream of streams) builder.push(stream);
    return builder.build();
  }

  // std: library/proc_macro/src/lib.rs:495 extend
  extend_TokenTree(trees: Iterable<TokenTree>): void {
    const builder = ConcatTreesHelper.new(0);
    for (const tree of trees) builder.push(tree);
    builder.append_to(this);
  }

  // std: library/proc_macro/src/lib.rs:505 extend
  extend_TokenStream(streams: Iterable<TokenStream>): void {
    const builder = ConcatStreamsHelper.new(0);
    for (const stream of streams) builder.push(stream);
    builder.append_to(this);
  }

  // extend_items!(Group Literal Punct Ident);
  // std: library/proc_macro/src/lib.rs:518 extend
  // PORT: the `extend_items!` expansion for `Group`, `Literal`, `Punct` and `Ident` (one TS method; the item's
  // `TokenTree` variant comes from its class).
  extend_items(iter: Iterable<Group | Literal | Punct | Ident>): void {
    const self = this;
    function* map(): Generator<TokenTree> {
      for (const item of iter) yield TokenTree.from(item);
    }
    self.extend_TokenTree(map());
  }

  /** PORT: `Extend::extend_one` (library/core/src/iter/traits/collect.rs, default `self.extend(Some(item))`). */
  extend_one_TokenTree(item: TokenTree): void {
    this.extend_TokenTree([item]);
  }

  // std: library/proc_macro/src/lib.rs:575 into_iter
  into_iter(): IntoIter {
    const trees = this._0 === undefined ? [] : BridgeMethods.ts_into_trees(this._0);
    return new IntoIter(trees);
  }
}

/// Prints tokens in a form convenient for debugging.
// std: library/proc_macro/src/lib.rs:360 fmt
export const debug_TokenStream: Debug<TokenStream> = (v, f) => {
  const items: string[] = [];
  const it = v.clone().into_iter();
  for (let t = it.next(); t !== undefined; t = it.next()) items.push(debug_TokenTree(t, f));
  return "TokenStream " + debug_list(f, items);
};

/// Error returned from `TokenStream::from_str`.
///
/// The contained error message is explicitly not guaranteed to be stable in any way,
/// and may change between Rust versions or across compilations.
// std-type: library/proc_macro/src/lib.rs:248 LexError
export class LexError {
  constructor(public _0: string) {}

  // std: library/proc_macro/src/lib.rs:252 fmt
  to_string(): string {
    return this._0;
  }
}
/** `#[derive(Debug)]` */
export const debug_LexError: Debug<LexError> = (v, f) => debug_tuple(f, "LexError", [debug_str(v._0)]);

/// Error returned from `TokenStream::expand_expr`.
// std-type: library/proc_macro/src/lib.rs:269 ExpandError
export class ExpandError {
  static readonly INSTANCE: ExpandError = new ExpandError();

  // std: library/proc_macro/src/lib.rs:273 fmt
  to_string(): string {
    return "macro expansion failed";
  }
}
/** `#[derive(Debug)]` */
export const debug_ExpandError: Debug<ExpandError> = () => "ExpandError";

// #[unstable(feature = "proc_macro_quote", issue = "54722")]
// pub use quote::{HasIterator, RepInterp, ThereIsNoIteratorInRepetition, ext, quote, quote_span};
export { ext, HasIterator, quote, quote_span, RepInterp, ThereIsNoIteratorInRepetition } from "./quote.ts";

// std: library/proc_macro/src/lib.rs:376 tree_to_bridge_tree
function tree_to_bridge_tree(tree: TokenTree): ClientTree {
  switch (tree.$) {
    case "Group":
      return { $: "Group", _0: tree._0._0 };
    case "Punct":
      return { $: "Punct", _0: tree._0._0 };
    case "Ident":
      return { $: "Ident", _0: tree._0._0 };
    case "Literal":
      return { $: "Literal", _0: tree._0._0 };
  }
}

/// Non-generic helper for implementing `FromIterator<TokenTree>` and
/// `Extend<TokenTree>` with less monomorphization in calling crates.
// std-type: library/proc_macro/src/lib.rs:397 ConcatTreesHelper
export class ConcatTreesHelper {
  constructor(public trees: ClientTree[]) {}

  // std: library/proc_macro/src/lib.rs:408 new
  static new(_capacity: number): ConcatTreesHelper {
    return new ConcatTreesHelper([]);
  }

  // std: library/proc_macro/src/lib.rs:412 push
  push(tree: TokenTree): void {
    this.trees.push(tree_to_bridge_tree(tree));
  }

  // std: library/proc_macro/src/lib.rs:416 build
  build(): TokenStream {
    if (this.trees.length === 0) {
      return new TokenStream(undefined);
    } else {
      return new TokenStream(BridgeMethods.ts_concat_trees(undefined, this.trees));
    }
  }

  // std: library/proc_macro/src/lib.rs:424 append_to
  append_to(stream: TokenStream): void {
    if (this.trees.length === 0) {
      return;
    }
    const base = stream._0;
    stream._0 = undefined;
    stream._0 = BridgeMethods.ts_concat_trees(base, this.trees);
  }
}

/// Non-generic helper for implementing `FromIterator<TokenStream>` and
/// `Extend<TokenStream>` with less monomorphization in calling crates.
// std-type: library/proc_macro/src/lib.rs:434 ConcatStreamsHelper
class ConcatStreamsHelper {
  constructor(public streams: client_TokenStream[]) {}

  // std: library/proc_macro/src/lib.rs:439 new
  static new(_capacity: number): ConcatStreamsHelper {
    return new ConcatStreamsHelper([]);
  }

  // std: library/proc_macro/src/lib.rs:443 push
  push(stream: TokenStream): void {
    if (stream._0 !== undefined) {
      this.streams.push(stream._0);
    }
  }

  // std: library/proc_macro/src/lib.rs:449 build
  build(): TokenStream {
    if (this.streams.length <= 1) {
      return new TokenStream(this.streams.pop());
    } else {
      return new TokenStream(BridgeMethods.ts_concat_streams(undefined, this.streams));
    }
  }

  // std: library/proc_macro/src/lib.rs:457 append_to
  append_to(stream: TokenStream): void {
    if (this.streams.length === 0) {
      return;
    }
    const base = stream._0;
    stream._0 = undefined;
    if (base === undefined && this.streams.length === 1) {
      stream._0 = this.streams.pop();
    } else {
      stream._0 = BridgeMethods.ts_concat_streams(base, this.streams);
    }
  }
}

/// Public implementation details for the `TokenStream` type, such as iterators.
// pub mod token_stream {

/// An iterator over `TokenStream`'s `TokenTree`s.
/// The iteration is "shallow", e.g., the iterator doesn't recurse into delimited groups,
/// and returns whole groups as token trees.
// std-type: library/proc_macro/src/lib.rs:538 IntoIter
// PORT: `std::vec::IntoIter` is the array plus a cursor.
export class IntoIter {
  private pos = 0;
  constructor(private readonly trees: ClientTree[]) {}

  /** `#[derive(Clone)]`: clones the remaining trees. */
  clone(): IntoIter {
    return new IntoIter(this.trees.slice(this.pos).map(clone_bridge_tree));
  }

  // std: library/proc_macro/src/lib.rs:552 next
  next(): TokenTree | undefined {
    if (this.pos >= this.trees.length) return undefined;
    const tree = this.trees[this.pos++]!;
    switch (tree.$) {
      case "Group":
        return { $: "Group", _0: new Group(tree._0) };
      case "Punct":
        return { $: "Punct", _0: new Punct(tree._0) };
      case "Ident":
        return { $: "Ident", _0: new Ident(tree._0) };
      case "Literal":
        return { $: "Literal", _0: new Literal(tree._0) };
    }
  }

  // std: library/proc_macro/src/lib.rs:561 size_hint
  size_hint(): [number, number | undefined] {
    const n = this.trees.length - this.pos;
    return [n, n];
  }

  // std: library/proc_macro/src/lib.rs:565 count
  count(): number {
    const n = this.trees.length - this.pos;
    this.pos = this.trees.length;
    return n;
  }

  *[Symbol.iterator](): Generator<TokenTree> {
    for (let t = this.next(); t !== undefined; t = this.next()) yield t;
  }
}

/** `#[derive(Clone)]` of `bridge::TokenTree<client::TokenStream, client::Span, client::Symbol>`. */
function clone_bridge_tree(tree: ClientTree): ClientTree {
  switch (tree.$) {
    case "Group":
      return { $: "Group", _0: clone_bridge_group(tree._0) };
    case "Punct":
      return { $: "Punct", _0: { ...tree._0 } };
    case "Ident":
      return { $: "Ident", _0: { ...tree._0 } };
    case "Literal":
      return { $: "Literal", _0: { ...tree._0 } };
  }
}

/** `#[derive(Clone)]` of `bridge::Group` (`stream: Option<client::TokenStream>` clones through `ts_clone`). */
function clone_bridge_group(g: BridgeGroup<client_TokenStream, client_Span>): BridgeGroup<client_TokenStream, client_Span> {
  return {
    delimiter: g.delimiter,
    stream: g.stream === undefined ? undefined : g.stream.clone(),
    span: new DelimSpan(g.span.open, g.span.close, g.span.entire),
  };
}
// }

/// `quote!(..)` accepts arbitrary tokens and expands into a `TokenStream` describing the input.
/// For example, `quote!(a + b)` will produce an expression, that, when evaluated, constructs
/// the `TokenStream` `[Ident("a"), Punct('+', Alone), Ident("b")]`.
///
/// Unquoting is done with `$`, and works by taking the single next ident as the unquoted term.
/// To quote `$` itself, use `$$`.
// pub macro quote($($t:tt)*) { /* compiler built-in */ }
// PORT: the `quote` macro item itself is `#[rustc_builtin_macro]`: it is `quote::quote` registered by
// rustc_builtin_macros, not code.

/// A region of source code, along with macro expansion information.
// std-type: library/proc_macro/src/lib.rs:601 Span
export class Span {
  constructor(public readonly _0: client_Span) {}

  /// A span that resolves at the macro definition site.
  // std: library/proc_macro/src/lib.rs:622 def_site
  static def_site(): Span {
    return new Span(client_Span.def_site());
  }

  /// The span of the invocation of the current procedural macro.
  /// Identifiers created with this span will be resolved as if they were written
  /// directly at the macro call location (call-site hygiene) and other code
  /// at the macro call site will be able to refer to them as well.
  // std: library/proc_macro/src/lib.rs:631 call_site
  static call_site(): Span {
    return new Span(client_Span.call_site());
  }

  /// A span that represents `macro_rules` hygiene, and sometimes resolves at the macro
  /// definition site (local variables, labels, `$crate`) and sometimes at the macro
  /// call site (everything else).
  /// The span location is taken from the call-site.
  // std: library/proc_macro/src/lib.rs:640 mixed_site
  static mixed_site(): Span {
    return new Span(client_Span.mixed_site());
  }

  /// The `Span` for the tokens in the previous macro expansion from which
  /// `self` was generated from, if any.
  // std: library/proc_macro/src/lib.rs:647 parent
  parent(): Span | undefined {
    const s = BridgeMethods.span_parent(this._0);
    return s === undefined ? undefined : new Span(s);
  }

  /// The span for the origin source code that `self` was generated from. If
  /// this `Span` wasn't generated from other macro expansions then the return
  /// value is the same as `*self`.
  // std: library/proc_macro/src/lib.rs:655 source
  source(): Span {
    return new Span(BridgeMethods.span_source(this._0));
  }

  /// Returns the span's byte position range in the source file.
  // std: library/proc_macro/src/lib.rs:661 byte_range
  byte_range(): Range {
    return BridgeMethods.span_byte_range(this._0);
  }

  /// Creates an empty span pointing to directly before this span.
  // std: library/proc_macro/src/lib.rs:667 start
  start(): Span {
    return new Span(BridgeMethods.span_start(this._0));
  }

  /// Creates an empty span pointing to directly after this span.
  // std: library/proc_macro/src/lib.rs:673 end
  end(): Span {
    return new Span(BridgeMethods.span_end(this._0));
  }

  /// The one-indexed line of the source file where the span starts.
  ///
  /// To obtain the line of the span's end, use `span.end().line()`.
  // std: library/proc_macro/src/lib.rs:681 line
  line(): number {
    return BridgeMethods.span_line(this._0);
  }

  /// The one-indexed column of the source file where the span starts.
  ///
  /// To obtain the column of the span's end, use `span.end().column()`.
  // std: library/proc_macro/src/lib.rs:689 column
  column(): number {
    return BridgeMethods.span_column(this._0);
  }

  /// The path to the source file in which this span occurs, for display purposes.
  ///
  /// This might not correspond to a valid file system path.
  /// It might be remapped (e.g. `"/src/lib.rs"`) or an artificial path (e.g. `"<command line>"`).
  // std: library/proc_macro/src/lib.rs:698 file
  file(): string {
    return BridgeMethods.span_file(this._0);
  }

  /// The path to the source file in which this span occurs on the local file system.
  ///
  /// This is the actual path on disk. It is unaffected by path remapping.
  ///
  /// This path should not be embedded in the output of the macro; prefer `file()` instead.
  // std: library/proc_macro/src/lib.rs:708 local_file
  // PORT: `PathBuf::from(String)` is the string itself.
  local_file(): string | undefined {
    return BridgeMethods.span_local_file(this._0);
  }

  /// Creates a new span encompassing `self` and `other`.
  ///
  /// Returns `None` if `self` and `other` are from different files.
  // std: library/proc_macro/src/lib.rs:716 join
  join(other: Span): Span | undefined {
    const s = BridgeMethods.span_join(this._0, other._0);
    return s === undefined ? undefined : new Span(s);
  }

  /// Creates a new span with the same line/column information as `self` but
  /// that resolves symbols as though it were at `other`.
  // std: library/proc_macro/src/lib.rs:723 resolved_at
  resolved_at(other: Span): Span {
    return new Span(BridgeMethods.span_resolved_at(this._0, other._0));
  }

  /// Creates a new span with the same name resolution behavior as `self` but
  /// with the line/column information of `other`.
  // std: library/proc_macro/src/lib.rs:730 located_at
  located_at(other: Span): Span {
    return other.resolved_at(this);
  }

  /// Compares two spans to see if they're equal.
  // std: library/proc_macro/src/lib.rs:736 eq
  eq(other: Span): boolean {
    return this._0 === other._0;
  }

  /// Returns the source text behind a span. This preserves the original source
  /// code, including spaces and comments. It only returns a result if the span
  /// corresponds to real source code.
  ///
  /// Note: The observable result of a macro should only rely on the tokens and
  /// not on this source text. The result of this function is a best effort to
  /// be used for diagnostics only.
  // std: library/proc_macro/src/lib.rs:748 source_text
  source_text(): string | undefined {
    return BridgeMethods.span_source_text(this._0);
  }

  // Used by the implementation of `Span::quote`
  // std: library/proc_macro/src/lib.rs:755 save_span
  save_span(): number {
    return BridgeMethods.span_save_span(this._0);
  }

  // Used by the implementation of `Span::quote`
  // std: library/proc_macro/src/lib.rs:762 recover_proc_macro_span
  static recover_proc_macro_span(id: number): Span {
    return new Span(BridgeMethods.span_recover_proc_macro_span(id));
  }

  // diagnostic_method!(error, Level::Error);
  // diagnostic_method!(warning, Level::Warning);
  // diagnostic_method!(note, Level::Note);
  // diagnostic_method!(help, Level::Help);
  /// Creates a new `Diagnostic` with the given `message` at the span
  /// `self`.
  error(message: string): Diagnostic {
    return Diagnostic.spanned(this, Level.Error, message);
  }
  /// Creates a new `Diagnostic` with the given `message` at the span
  /// `self`.
  warning(message: string): Diagnostic {
    return Diagnostic.spanned(this, Level.Warning, message);
  }
  /// Creates a new `Diagnostic` with the given `message` at the span
  /// `self`.
  note(message: string): Diagnostic {
    return Diagnostic.spanned(this, Level.Note, message);
  }
  /// Creates a new `Diagnostic` with the given `message` at the span
  /// `self`.
  help(message: string): Diagnostic {
    return Diagnostic.spanned(this, Level.Help, message);
  }
}

/// Prints a span in a form convenient for debugging.
// std: library/proc_macro/src/lib.rs:775 fmt
export const debug_Span: Debug<Span> = (v, f) => debug_client_Span(v._0, f);

/// A single token or a delimited sequence of token trees (e.g., `[1, (), ..]`).
// std-type: library/proc_macro/src/lib.rs:783 TokenTree
export type TokenTree =
  /// A token stream surrounded by bracket delimiters.
  | { readonly $: "Group"; readonly _0: Group }
  /// An identifier.
  | { readonly $: "Ident"; readonly _0: Ident }
  /// A single punctuation character (`+`, `,`, `$`, etc.).
  | { readonly $: "Punct"; readonly _0: Punct }
  /// A literal character (`'a'`), string (`"hello"`), number (`2.3`), etc.
  | { readonly $: "Literal"; readonly _0: Literal };
export const TokenTree = {
  /// Returns the span of this tree, delegating to the `span` method of
  /// the contained token or a delimited stream.
  // std: library/proc_macro/src/lib.rs:807 span
  span(self: TokenTree): Span {
    switch (self.$) {
      case "Group":
        return self._0.span();
      case "Ident":
        return self._0.span();
      case "Punct":
        return self._0.span();
      case "Literal":
        return self._0.span();
    }
  },

  /// Configures the span for *only this token*.
  ///
  /// Note that if this token is a `Group` then this method will not configure
  /// the span of each of the internal tokens, this will simply delegate to
  /// the `set_span` method of each variant.
  // std: library/proc_macro/src/lib.rs:822 set_span
  set_span(self: TokenTree, span: Span): void {
    switch (self.$) {
      case "Group":
        return self._0.set_span(span);
      case "Ident":
        return self._0.set_span(span);
      case "Punct":
        return self._0.set_span(span);
      case "Literal":
        return self._0.set_span(span);
    }
  },

  // std: library/proc_macro/src/lib.rs:849 from
  from_Group(g: Group): TokenTree {
    return { $: "Group", _0: g };
  },

  // std: library/proc_macro/src/lib.rs:856 from
  from_Ident(g: Ident): TokenTree {
    return { $: "Ident", _0: g };
  },

  // std: library/proc_macro/src/lib.rs:863 from
  from_Punct(g: Punct): TokenTree {
    return { $: "Punct", _0: g };
  },

  // std: library/proc_macro/src/lib.rs:870 from
  from_Literal(g: Literal): TokenTree {
    return { $: "Literal", _0: g };
  },

  /** PORT: `TokenTree::from(x)`: Rust picks the `From` impl by the argument's type; here by its class. */
  from(g: Group | Ident | Punct | Literal): TokenTree {
    if (g instanceof Group) return TokenTree.from_Group(g);
    if (g instanceof Ident) return TokenTree.from_Ident(g);
    if (g instanceof Punct) return TokenTree.from_Punct(g);
    return TokenTree.from_Literal(g);
  },

  /// Prints the token tree as a string that is supposed to be losslessly convertible back
  /// into the same token tree (modulo spans), except for possibly `TokenTree::Group`s
  /// with `Delimiter::None` delimiters and negative numeric literals.
  ///
  /// Note: the exact form of the output is subject to change, e.g. there might
  /// be changes in the whitespace used between tokens. Therefore, you should
  /// *not* do any kind of simple substring matching on the output string (as
  /// produced by `to_string`) to implement a proc macro, because that matching
  /// might stop working if such changes happen. Instead, you should work at the
  /// `TokenTree` level, e.g. matching against `TokenTree::Ident`,
  /// `TokenTree::Punct`, or `TokenTree::Literal`.
  // std: library/proc_macro/src/lib.rs:888 fmt
  to_string(self: TokenTree): string {
    switch (self.$) {
      case "Group":
        return self._0.to_string();
      case "Ident":
        return self._0.to_string();
      case "Punct":
        return self._0.to_string();
      case "Literal":
        return self._0.to_string();
    }
  },
};

/** `#[derive(Clone)]` */
export function clone_TokenTree(t: TokenTree): TokenTree {
  switch (t.$) {
    case "Group":
      return { $: "Group", _0: t._0.clone() };
    case "Ident":
      return { $: "Ident", _0: t._0.clone() };
    case "Punct":
      return { $: "Punct", _0: t._0.clone() };
    case "Literal":
      return { $: "Literal", _0: t._0.clone() };
  }
}

/// Prints token tree in a form convenient for debugging.
// std: library/proc_macro/src/lib.rs:835 fmt
export const debug_TokenTree: Debug<TokenTree> = (v, f) => {
  // Each of these has the name in the struct type in the derived debug,
  // so don't bother with an extra layer of indirection
  switch (v.$) {
    case "Group":
      return debug_Group(v._0, f);
    case "Ident":
      return debug_Ident(v._0, f);
    case "Punct":
      return debug_Punct(v._0, f);
    case "Literal":
      return debug_Literal(v._0, f);
  }
};

/// A delimited token stream.
///
/// A `Group` internally contains a `TokenStream` which is surrounded by `Delimiter`s.
// std-type: library/proc_macro/src/lib.rs:903 Group
export class Group {
  constructor(public _0: BridgeGroup<client_TokenStream, client_Span>) {}

  /** `#[derive(Clone)]` */
  clone(): Group {
    return new Group(clone_bridge_group(this._0));
  }

  /// Creates a new `Group` with the given delimiter and token stream.
  ///
  /// This constructor will set the span for this group to
  /// `Span::call_site()`. To change the span you can use the `set_span`
  /// method below.
  // std: library/proc_macro/src/lib.rs:951 new
  static new(delimiter: Delimiter, stream: TokenStream): Group {
    return new Group({
      delimiter,
      stream: stream._0,
      span: DelimSpan.from_single(Span.call_site()._0),
    });
  }

  /// Returns the delimiter of this `Group`
  // std: library/proc_macro/src/lib.rs:961 delimiter
  delimiter(): Delimiter {
    return this._0.delimiter;
  }

  /// Returns the `TokenStream` of tokens that are delimited in this `Group`.
  ///
  /// Note that the returned token stream does not include the delimiter
  /// returned above.
  // std: library/proc_macro/src/lib.rs:970 stream
  stream(): TokenStream {
    return new TokenStream(this._0.stream === undefined ? undefined : this._0.stream.clone());
  }

  /// Returns the span for the delimiters of this token stream, spanning the
  /// entire `Group`.
  ///
  /// ```text
  /// pub fn span(&self) -> Span {
  ///            ^^^^^^^
  /// ```
  // std: library/proc_macro/src/lib.rs:982 span
  span(): Span {
    return new Span(this._0.span.entire);
  }

  /// Returns the span pointing to the opening delimiter of this group.
  ///
  /// ```text
  /// pub fn span_open(&self) -> Span {
  ///                 ^
  /// ```
  // std: library/proc_macro/src/lib.rs:993 span_open
  span_open(): Span {
    return new Span(this._0.span.open);
  }

  /// Returns the span pointing to the closing delimiter of this group.
  ///
  /// ```text
  /// pub fn span_close(&self) -> Span {
  ///                        ^
  /// ```
  // std: library/proc_macro/src/lib.rs:1004 span_close
  span_close(): Span {
    return new Span(this._0.span.close);
  }

  /// Configures the span for this `Group`'s delimiters, but not its internal
  /// tokens.
  ///
  /// This method will **not** set the span of all the internal tokens spanned
  /// by this group, but rather it will only set the span of the delimiter
  /// tokens at the level of the `Group`.
  // std: library/proc_macro/src/lib.rs:1015 set_span
  set_span(span: Span): void {
    this._0.span = DelimSpan.from_single(span._0);
  }

  /// Prints the group as a string that should be losslessly convertible back
  /// into the same group (modulo spans), except for possibly `TokenTree::Group`s
  /// with `Delimiter::None` delimiters.
  // std: library/proc_macro/src/lib.rs:1025 fmt
  to_string(): string {
    return TokenStream.from_TokenTree(TokenTree.from_Group(this.clone())).to_string();
  }
}

// std: library/proc_macro/src/lib.rs:1032 fmt
export const debug_Group: Debug<Group> = (v, f) =>
  debug_struct(f, "Group", [
    ["delimiter", debug_Delimiter(v.delimiter(), f)],
    ["stream", debug_TokenStream(v.stream(), f)],
    ["span", debug_Span(v.span(), f)],
  ]);

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

/// A `Punct` is a single punctuation character such as `+`, `-` or `#`.
///
/// Multi-character operators like `+=` are represented as two instances of `Punct` with different
/// forms of `Spacing` returned.
// std-type: library/proc_macro/src/lib.rs:1047 Punct
export class Punct {
  constructor(public _0: BridgePunct<client_Span>) {}

  /** `#[derive(Clone)]` */
  clone(): Punct {
    return new Punct({ ...this._0 });
  }

  /// Creates a new `Punct` from the given character and spacing.
  /// The `ch` argument must be a valid punctuation character permitted by the language,
  /// otherwise the function will panic.
  ///
  /// The returned `Punct` will have the default span of `Span::call_site()`
  /// which can be further configured with the `set_span` method below.
  // std: library/proc_macro/src/lib.rs:1090 new
  static new(ch: number, spacing: Spacing): Punct {
    if (!PUNCT_LEGAL_CHARS.includes(ch)) {
      panic(`unsupported character \`${debug_char(ch)}\``);
    }
    return new Punct({
      ch: ch,
      joint: spacing === "Joint",
      span: Span.call_site()._0,
    });
  }

  /// Returns the value of this punctuation character as `char`.
  // std: library/proc_macro/src/lib.rs:1107 as_char
  as_char(): number {
    return this._0.ch;
  }

  /// Returns the spacing of this punctuation character, indicating whether it can be potentially
  /// combined into a multi-character operator with the following token (`Joint`), or whether the
  /// operator has definitely ended (`Alone`).
  // std: library/proc_macro/src/lib.rs:1115 spacing
  spacing(): Spacing {
    return this._0.joint ? "Joint" : "Alone";
  }

  /// Returns the span for this punctuation character.
  // std: library/proc_macro/src/lib.rs:1121 span
  span(): Span {
    return new Span(this._0.span);
  }

  /// Configure the span for this punctuation character.
  // std: library/proc_macro/src/lib.rs:1127 set_span
  set_span(span: Span): void {
    this._0.span = span._0;
  }

  /// Prints the punctuation character as a string that should be losslessly convertible
  /// back into the same character.
  // std: library/proc_macro/src/lib.rs:1136 fmt
  to_string(): string {
    return String.fromCodePoint(this.as_char());
  }

  // std: library/proc_macro/src/lib.rs:1154 eq
  eq_char(rhs: number): boolean {
    return this.as_char() === rhs;
  }
}

/** `Punct::new`'s `LEGAL_CHARS` (`'=', '<', '>', '!', '~', '+', '-', '*', '/', '%', '^', '&', '|', '@', '.', ',', ';', ':', '#', '$', '?', '\''`). */
const PUNCT_LEGAL_CHARS: readonly number[] = [..."=<>!~+-*/%^&|@.,;:#$?'"].map((c) => c.charCodeAt(0));

// std: library/proc_macro/src/lib.rs:1143 fmt
export const debug_Punct: Debug<Punct> = (v, f) =>
  debug_struct(f, "Punct", [
    ["ch", debug_char(v.as_char())],
    ["spacing", debug_Spacing(v.spacing(), f)],
    ["span", debug_Span(v.span(), f)],
  ]);

// std: library/proc_macro/src/lib.rs:1161 eq
export function char_eq_Punct(self: number, rhs: Punct): boolean {
  return self === rhs.as_char();
}

/// Indicates whether a `Punct` token can join with the following token
/// to form a multi-character operator.
// std-type: library/proc_macro/src/lib.rs:1058 Spacing
export type Spacing =
  /// A `Punct` token can join with the following token to form a multi-character operator.
  ///
  /// In token streams constructed using proc macro interfaces, `Joint` punctuation tokens can be
  /// followed by any other tokens. However, in token streams parsed from source code, the
  /// compiler will only set spacing to `Joint` in the following cases.
  /// - When a `Punct` is immediately followed by another `Punct` without a whitespace. E.g. `+`
  ///   is `Joint` in `+=` and `++`.
  /// - When a single quote `'` is immediately followed by an identifier without a whitespace.
  ///   E.g. `'` is `Joint` in `'lifetime`.
  ///
  /// This list may be extended in the future to enable more token combinations.
  | "Joint"
  /// A `Punct` token cannot join with the following token to form a multi-character operator.
  ///
  /// `Alone` punctuation tokens can be followed by any other tokens. In token streams parsed
  /// from source code, the compiler will set spacing to `Alone` in all cases not covered by the
  /// conditions for `Joint` above. E.g. `+` is `Alone` in `+ =`, `+ident` and `+()`. In
  /// particular, tokens not followed by anything will be marked as `Alone`.
  | "Alone";
export const Spacing = { Joint: "Joint", Alone: "Alone" } as const;
/** `#[derive(Debug)]` */
export const debug_Spacing: Debug<Spacing> = (v) => v;

/// An identifier (`ident`).
// std-type: library/proc_macro/src/lib.rs:1169 Ident
export class Ident {
  constructor(public _0: BridgeIdent<client_Span, client_Symbol>) {}

  /** `#[derive(Clone)]` */
  clone(): Ident {
    return new Ident({ ...this._0 });
  }

  /// Creates a new `Ident` with the given `string` as well as the specified
  /// `span`.
  /// The `string` argument must be a valid identifier permitted by the
  /// language (including keywords, e.g. `self` or `fn`). Otherwise, the function will panic.
  ///
  /// The constructed identifier will be NFC-normalized. See the [Reference] for more info.
  ///
  /// Note that `span`, currently in rustc, configures the hygiene information
  /// for this identifier.
  ///
  /// As of this time `Span::call_site()` explicitly opts-in to "call-site" hygiene
  /// meaning that identifiers created with this span will be resolved as if they were written
  /// directly at the location of the macro call, and other code at the macro call site will be
  /// able to refer to them as well.
  ///
  /// Later spans like `Span::def_site()` will allow to opt-in to "definition-site" hygiene
  /// meaning that identifiers created with this span will be resolved at the location of the
  /// macro definition and other code at the macro call site will not be able to refer to them.
  ///
  /// Due to the current importance of hygiene this constructor, unlike other
  /// tokens, requires a `Span` to be specified at construction.
  ///
  /// [Reference]: https://doc.rust-lang.org/nightly/reference/identifiers.html#r-ident.normalization
  // std: library/proc_macro/src/lib.rs:1196 new
  static new(string: string, span: Span): Ident {
    return new Ident({
      sym: client_Symbol.new_ident(string, false),
      kind: IdentKind.Normal,
      span: span._0,
    });
  }

  /// Same as `Ident::new`, but creates a raw identifier (`r#ident`).
  /// The `string` argument be a valid identifier permitted by the language
  /// (including keywords, e.g. `fn`). Keywords which are usable in path segments
  /// (e.g. `self`, `super`) are not supported, and will cause a panic.
  // std: library/proc_macro/src/lib.rs:1209 new_raw
  static new_raw(string: string, span: Span): Ident {
    return new Ident({
      sym: client_Symbol.new_ident(string, true),
      kind: IdentKind.Raw,
      span: span._0,
    });
  }

  /// Returns the span of this `Ident`, encompassing the entire string returned
  /// by [`to_string`](ToString::to_string).
  // std: library/proc_macro/src/lib.rs:1220 span
  span(): Span {
    return new Span(this._0.span);
  }

  /// Configures the span of this `Ident`, possibly changing its hygiene context.
  // std: library/proc_macro/src/lib.rs:1226 set_span
  set_span(span: Span): void {
    this._0.span = span._0;
  }

  /// Prints the identifier as a string that should be losslessly convertible back
  /// into the same identifier.
  // std: library/proc_macro/src/lib.rs:1235 fmt
  to_string(): string {
    let f = "";
    const prefix = IdentKind.prefix(this._0.kind);
    if (prefix !== undefined) {
      f += prefix;
    }
    return f + display_client_Symbol(this._0.sym);
  }
}

// std: library/proc_macro/src/lib.rs:1245 fmt
export const debug_Ident: Debug<Ident> = (v, f) =>
  debug_struct(f, "Ident", [
    ["ident", debug_str(v.to_string())],
    ["span", debug_Span(v.span(), f)],
  ]);

/// A literal string (`"hello"`), byte string (`b"hello"`), C string (`c"hello"`),
/// character (`'a'`), byte character (`b'a'`), an integer or floating point number
/// with or without a suffix (`1`, `1u8`, `2.3`, `2.3f32`).
/// Boolean literals like `true` and `false` do not belong here, they are `Ident`s.
// std-type: library/proc_macro/src/lib.rs:1259 Literal
// PORT: the `suffixed_int_literals!` / `unsuffixed_int_literals!` / `integer_values!` / `float_values!` expansions
// are one-line methods calling a private helper holding the macro body (`suffixed_int_literal`,
// `unsuffixed_int_literal`, `integer_value`, `float_value`). `u64`/`i64`/`u128`/`i128` values are `bigint`.
export class Literal {
  constructor(public _0: BridgeLiteral<client_Span, client_Symbol>) {}

  /** `#[derive(Clone)]` */
  clone(): Literal {
    return new Literal({ ...this._0 });
  }

  // std: library/proc_macro/src/lib.rs:1371 new
  static new(kind: LitKind, value: string, suffix: string | undefined): Literal {
    return new Literal({
      kind,
      symbol: client_Symbol.new(value),
      suffix: suffix === undefined ? undefined : client_Symbol.new(suffix),
      span: Span.call_site()._0,
    });
  }

  // suffixed_int_literals! { .. }
  /// Creates a new suffixed integer literal with the specified value.
  ///
  /// This function will create an integer like `1u32` where the integer
  /// value specified is the first part of the token and the integral is
  /// also suffixed at the end.
  /// Literals created from negative numbers might not survive round-trips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// Literals created through this method have the `Span::call_site()`
  /// span by default, which can be configured with the `set_span` method
  /// below.
  static u8_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "u8");
  }
  static u16_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "u16");
  }
  static u32_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "u32");
  }
  static u64_suffixed(n: bigint): Literal {
    return suffixed_int_literal(n, "u64");
  }
  static u128_suffixed(n: bigint): Literal {
    return suffixed_int_literal(n, "u128");
  }
  static usize_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "usize");
  }
  static i8_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "i8");
  }
  static i16_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "i16");
  }
  static i32_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "i32");
  }
  static i64_suffixed(n: bigint): Literal {
    return suffixed_int_literal(n, "i64");
  }
  static i128_suffixed(n: bigint): Literal {
    return suffixed_int_literal(n, "i128");
  }
  static isize_suffixed(n: number): Literal {
    return suffixed_int_literal(n, "isize");
  }

  // unsuffixed_int_literals! { .. }
  /// Creates a new unsuffixed integer literal with the specified value.
  ///
  /// This function will create an integer like `1` where the integer
  /// value specified is the first part of the token. No suffix is
  /// specified on this token, meaning that invocations like
  /// `Literal::i8_unsuffixed(1)` are equivalent to
  /// `Literal::u32_unsuffixed(1)`.
  /// Literals created from negative numbers might not survive roundtrips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// Literals created through this method have the `Span::call_site()`
  /// span by default, which can be configured with the `set_span` method
  /// below.
  static u8_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static u16_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static u32_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static u64_unsuffixed(n: bigint): Literal {
    return unsuffixed_int_literal(n);
  }
  static u128_unsuffixed(n: bigint): Literal {
    return unsuffixed_int_literal(n);
  }
  static usize_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static i8_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static i16_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static i32_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }
  static i64_unsuffixed(n: bigint): Literal {
    return unsuffixed_int_literal(n);
  }
  static i128_unsuffixed(n: bigint): Literal {
    return unsuffixed_int_literal(n);
  }
  static isize_unsuffixed(n: number): Literal {
    return unsuffixed_int_literal(n);
  }

  /// Creates a new unsuffixed floating-point literal.
  ///
  /// This constructor is similar to those like `Literal::i8_unsuffixed` where
  /// the float's value is emitted directly into the token but no suffix is
  /// used, so it may be inferred to be a `f64` later in the compiler.
  /// Literals created from negative numbers might not survive roundtrips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// # Panics
  ///
  /// This function requires that the specified float is finite, for
  /// example if it is infinity or NaN this function will panic.
  // std: library/proc_macro/src/lib.rs:1423 f32_unsuffixed
  static f32_unsuffixed(n: number): Literal {
    if (!Number.isFinite(n)) {
      panic(`Invalid float literal ${display_f32(n)}`);
    }
    let repr = display_f32(n);
    if (!repr.includes(".")) {
      repr += ".0";
    }
    return Literal.new(LitKind.Float, repr, undefined);
  }

  /// Creates a new suffixed floating-point literal.
  ///
  /// This constructor will create a literal like `1.0f32` where the value
  /// specified is the preceding part of the token and `f32` is the suffix of
  /// the token. This token will always be inferred to be an `f32` in the
  /// compiler.
  /// Literals created from negative numbers might not survive roundtrips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// # Panics
  ///
  /// This function requires that the specified float is finite, for
  /// example if it is infinity or NaN this function will panic.
  // std: library/proc_macro/src/lib.rs:1448 f32_suffixed
  static f32_suffixed(n: number): Literal {
    if (!Number.isFinite(n)) {
      panic(`Invalid float literal ${display_f32(n)}`);
    }
    return Literal.new(LitKind.Float, display_f32(n), "f32");
  }

  /// Creates a new unsuffixed floating-point literal.
  ///
  /// This constructor is similar to those like `Literal::i8_unsuffixed` where
  /// the float's value is emitted directly into the token but no suffix is
  /// used, so it may be inferred to be a `f64` later in the compiler.
  /// Literals created from negative numbers might not survive roundtrips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// # Panics
  ///
  /// This function requires that the specified float is finite, for
  /// example if it is infinity or NaN this function will panic.
  // std: library/proc_macro/src/lib.rs:1468 f64_unsuffixed
  static f64_unsuffixed(n: number): Literal {
    if (!Number.isFinite(n)) {
      panic(`Invalid float literal ${display_f64(n)}`);
    }
    let repr = display_f64(n);
    if (!repr.includes(".")) {
      repr += ".0";
    }
    return Literal.new(LitKind.Float, repr, undefined);
  }

  /// Creates a new suffixed floating-point literal.
  ///
  /// This constructor will create a literal like `1.0f64` where the value
  /// specified is the preceding part of the token and `f64` is the suffix of
  /// the token. This token will always be inferred to be an `f64` in the
  /// compiler.
  /// Literals created from negative numbers might not survive roundtrips through
  /// `TokenStream` or strings and may be broken into two tokens (`-` and positive literal).
  ///
  /// # Panics
  ///
  /// This function requires that the specified float is finite, for
  /// example if it is infinity or NaN this function will panic.
  // std: library/proc_macro/src/lib.rs:1493 f64_suffixed
  static f64_suffixed(n: number): Literal {
    if (!Number.isFinite(n)) {
      panic(`Invalid float literal ${display_f64(n)}`);
    }
    return Literal.new(LitKind.Float, display_f64(n), "f64");
  }

  /// String literal.
  // std: library/proc_macro/src/lib.rs:1502 string
  static string(string: string): Literal {
    const escape: EscapeOptions = {
      escape_single_quote: false,
      escape_double_quote: true,
      escape_nonascii: false,
    };
    const repr = escape_bytes(utf8(string), escape);
    return Literal.new(LitKind.Str, repr, undefined);
  }

  /// Character literal.
  // std: library/proc_macro/src/lib.rs:1514 character
  static character(ch: number): Literal {
    const escape: EscapeOptions = {
      escape_single_quote: true,
      escape_double_quote: false,
      escape_nonascii: false,
    };
    const repr = escape_bytes(utf8(String.fromCodePoint(ch)), escape);
    return Literal.new(LitKind.Char, repr, undefined);
  }

  /// Byte character literal.
  // std: library/proc_macro/src/lib.rs:1526 byte_character
  static byte_character(byte: number): Literal {
    const escape: EscapeOptions = {
      escape_single_quote: true,
      escape_double_quote: false,
      escape_nonascii: true,
    };
    const repr = escape_bytes(Uint8Array.of(byte), escape);
    return Literal.new(LitKind.Byte, repr, undefined);
  }

  /// Byte string literal.
  // std: library/proc_macro/src/lib.rs:1538 byte_string
  static byte_string(bytes: Uint8Array): Literal {
    const escape: EscapeOptions = {
      escape_single_quote: false,
      escape_double_quote: true,
      escape_nonascii: true,
    };
    const repr = escape_bytes(bytes, escape);
    return Literal.new(LitKind.ByteStr, repr, undefined);
  }

  /// C string literal.
  // std: library/proc_macro/src/lib.rs:1550 c_string
  // PORT: `&CStr` is its `to_bytes()` (no terminating NUL, no interior NUL).
  static c_string(string: Uint8Array): Literal {
    const escape: EscapeOptions = {
      escape_single_quote: false,
      escape_double_quote: true,
      escape_nonascii: false,
    };
    const repr = escape_bytes(string, escape);
    return Literal.new(LitKind.CStr, repr, undefined);
  }

  /// Returns the span encompassing this literal.
  // std: library/proc_macro/src/lib.rs:1562 span
  span(): Span {
    return new Span(this._0.span);
  }

  /// Configures the span associated for this literal.
  // std: library/proc_macro/src/lib.rs:1568 set_span
  set_span(span: Span): void {
    this._0.span = span._0;
  }

  /// Returns a `Span` that is a subset of `self.span()` containing only the
  /// source bytes in range `range`. Returns `None` if the would-be trimmed
  /// span is outside the bounds of `self`.
  // FIXME(SergioBenitez): check that the byte range starts and ends at a
  // UTF-8 boundary of the source. otherwise, it's likely that a panic will
  // occur elsewhere when the source text is printed.
  // FIXME(SergioBenitez): there is no way for the user to know what
  // `self.span()` actually maps to, so this method can currently only be
  // called blindly. For example, `to_string()` for the character 'c' returns
  // "'\u{63}'"; there is no way for the user to know whether the source text
  // was 'c' or whether it was '\u{63}'.
  // std: library/proc_macro/src/lib.rs:1584 subspan
  // PORT: `R: RangeBounds<usize>` is passed as its `(start_bound(), end_bound())`.
  subspan(range: [Bound, Bound]): Span | undefined {
    const s = BridgeMethods.span_subspan(this._0.span, range[0], range[1]);
    return s === undefined ? undefined : new Span(s);
  }

  // std: library/proc_macro/src/lib.rs:1593 with_symbol_and_suffix
  private with_symbol_and_suffix<R>(f: (symbol: string, suffix: string) => R): R {
    return client_Symbol.with(this._0.symbol, (symbol) => {
      const suffix = this._0.suffix;
      if (suffix !== undefined) return client_Symbol.with(suffix, (suffix) => f(symbol, suffix));
      return f(symbol, "");
    });
  }

  /// Invokes the callback with a `&[&str]` consisting of each part of the
  /// literal's representation. This is done to allow the `ToString` and
  /// `Display` implementations to borrow references to symbol values, and
  /// both be optimized to reduce overhead.
  // std: library/proc_macro/src/lib.rs:1604 with_stringify_parts
  private with_stringify_parts<R>(f: (parts: readonly string[]) => R): R {
    /// Returns a string containing exactly `num` '#' characters.
    /// Uses a 256-character source string literal which is always safe to
    /// index with a `u8` index.
    // std: library/proc_macro/src/lib.rs:1608 get_hashes_str
    function get_hashes_str(num: number): string {
      const HASHES = "#".repeat(256);
      // const _: () = assert!(HASHES.len() == 256);
      return HASHES.slice(0, num);
    }

    return this.with_symbol_and_suffix((symbol, suffix) => {
      const kind = this._0.kind;
      switch (kind.$) {
        case "Byte":
          return f(["b'", symbol, "'", suffix]);
        case "Char":
          return f(["'", symbol, "'", suffix]);
        case "Str":
          return f(['"', symbol, '"', suffix]);
        case "StrRaw": {
          const hashes = get_hashes_str(kind._0);
          return f(["r", hashes, '"', symbol, '"', hashes, suffix]);
        }
        case "ByteStr":
          return f(['b"', symbol, '"', suffix]);
        case "ByteStrRaw": {
          const hashes = get_hashes_str(kind._0);
          return f(["br", hashes, '"', symbol, '"', hashes, suffix]);
        }
        case "CStr":
          return f(['c"', symbol, '"', suffix]);
        case "CStrRaw": {
          const hashes = get_hashes_str(kind._0);
          return f(["cr", hashes, '"', symbol, '"', hashes, suffix]);
        }

        case "Integer":
        case "Float":
        case "ErrWithGuar":
          return f([symbol, suffix]);
      }
    });
  }

  /// Returns the unescaped character value if the current literal is a byte character literal.
  // std: library/proc_macro/src/lib.rs:1646 byte_character_value
  byte_character_value(): Result<number, ConversionErrorKind> {
    return client_Symbol.with(this._0.symbol, (symbol): Result<number, ConversionErrorKind> => {
      if (this._0.kind.$ === "Byte") {
        const r = unescape_byte(Str.from(symbol));
        if (r.$ === "Ok") return r;
        return Err({ $: "FailedToUnescape", _0: EscapeError.from(r._0) });
      }
      return Err(ConversionErrorKind.InvalidLiteralKind);
    });
  }

  /// Returns the unescaped character value if the current literal is a character literal.
  // std: library/proc_macro/src/lib.rs:1656 character_value
  character_value(): Result<number, ConversionErrorKind> {
    return client_Symbol.with(this._0.symbol, (symbol): Result<number, ConversionErrorKind> => {
      if (this._0.kind.$ === "Char") {
        const r = unescape_char(Str.from(symbol));
        if (r.$ === "Ok") return r;
        return Err({ $: "FailedToUnescape", _0: EscapeError.from(r._0) });
      }
      return Err(ConversionErrorKind.InvalidLiteralKind);
    });
  }

  /// Returns the unescaped string value if the current literal is a string or a string literal.
  // std: library/proc_macro/src/lib.rs:1666 str_value
  str_value(): Result<string, ConversionErrorKind> {
    return client_Symbol.with(this._0.symbol, (symbol): Result<string, ConversionErrorKind> => {
      switch (this._0.kind.$) {
        case "Str": {
          if (symbol.includes("\\")) {
            let buf = "";
            let error: ConversionErrorKind | undefined = undefined;
            // Force-inlining here is aggressive but the closure is
            // called on every char in the string, so it can be hot in
            // programs with many long strings containing escapes.
            unescape_str(Str.from(symbol), (_s, _e, c) => {
              if (c.$ === "Ok") {
                buf += String.fromCodePoint(c._0);
              } else {
                const err = c._0;
                if (EE.is_fatal(err)) {
                  error = { $: "FailedToUnescape", _0: EscapeError.from(err) };
                }
              }
            });
            if (error !== undefined) return Err(error);
            return Ok(buf);
          } else {
            return Ok(symbol);
          }
        }
        case "StrRaw":
          return Ok(symbol);
        default:
          return Err(ConversionErrorKind.InvalidLiteralKind);
      }
    });
  }

  /// Returns the unescaped string value if the current literal is a c-string or a c-string
  /// literal.
  // std: library/proc_macro/src/lib.rs:1700 cstr_value
  cstr_value(): Result<Uint8Array, ConversionErrorKind> {
    return client_Symbol.with(this._0.symbol, (symbol): Result<Uint8Array, ConversionErrorKind> => {
      switch (this._0.kind.$) {
        case "CStr": {
          let error: ConversionErrorKind | undefined = undefined;
          const buf: number[] = [];

          unescape_c_str(Str.from(symbol), (_span_s, _span_e, res: Result<MixedUnit, EE>) => {
            if (res.$ === "Ok") {
              const u = res._0;
              if (u.$ === "Char") {
                buf.push(...utf8(String.fromCodePoint(u._0)));
              } else {
                buf.push(u._0);
              }
            } else {
              const err = res._0;
              if (EE.is_fatal(err)) {
                error = { $: "FailedToUnescape", _0: EscapeError.from(err) };
              }
            }
          });
          if (error !== undefined) {
            return Err(error);
          } else {
            buf.push(0);
            return Ok(Uint8Array.from(buf));
          }
        }
        case "CStrRaw": {
          // Raw strings have no escapes so we can convert the symbol
          // directly to a `Lrc<u8>` after appending the terminating NUL
          // char.
          const buf = [...utf8(symbol)];
          buf.push(0);
          return Ok(Uint8Array.from(buf));
        }
        default:
          return Err(ConversionErrorKind.InvalidLiteralKind);
      }
    });
  }

  /// Returns the unescaped string value if the current literal is a byte string or a byte string
  /// literal.
  // std: library/proc_macro/src/lib.rs:1739 byte_str_value
  byte_str_value(): Result<Uint8Array, ConversionErrorKind> {
    return client_Symbol.with(this._0.symbol, (symbol): Result<Uint8Array, ConversionErrorKind> => {
      switch (this._0.kind.$) {
        case "ByteStr": {
          const buf: number[] = [];
          let error: ConversionErrorKind | undefined = undefined;

          unescape_byte_str(Str.from(symbol), (_s, _e, res) => {
            if (res.$ === "Ok") {
              buf.push(res._0);
            } else {
              const err = res._0;
              if (EE.is_fatal(err)) {
                error = { $: "FailedToUnescape", _0: EscapeError.from(err) };
              }
            }
          });
          if (error !== undefined) return Err(error);
          return Ok(Uint8Array.from(buf));
        }
        case "ByteStrRaw":
          // Raw strings have no escapes so we can convert the symbol
          // directly to a `Lrc<u8>`.
          return Ok(utf8(symbol));
        default:
          return Err(ConversionErrorKind.InvalidLiteralKind);
      }
    });
  }

  // integer_values! { .. }
  /// Returns the unescaped `u8` value if the literal is a `u8` or if it's an "unmarked" integer which doesn't overflow.
  u8_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("u8", 8, false));
  }
  u16_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("u16", 16, false));
  }
  u32_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("u32", 32, false));
  }
  u64_value(): Result<bigint, ConversionErrorKind> {
    return this.integer_value("u64", 64, false);
  }
  u128_value(): Result<bigint, ConversionErrorKind> {
    return this.integer_value("u128", 128, false);
  }
  i8_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("i8", 8, true));
  }
  i16_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("i16", 16, true));
  }
  i32_value(): Result<number, ConversionErrorKind> {
    return as_number(this.integer_value("i32", 32, true));
  }
  i64_value(): Result<bigint, ConversionErrorKind> {
    return this.integer_value("i64", 64, true);
  }
  i128_value(): Result<bigint, ConversionErrorKind> {
    return this.integer_value("i128", 128, true);
  }

  /** The `integer_values!` body for `$nb` (`nb`, `bits`, `signed`). */
  private integer_value(nb: string, bits: number, signed: boolean): Result<bigint, ConversionErrorKind> {
    if (!LitKind_eq(this._0.kind, LitKind.Integer)) {
      return Err(ConversionErrorKind.InvalidLiteralKind);
    }
    return this.with_symbol_and_suffix((symbol0, suffix): Result<bigint, ConversionErrorKind> => {
      if (suffix === nb || suffix === "") {
        const symbol = strip_underscores(symbol0);
        const [number, base] = parse_number(symbol);
        const v = int_from_str_radix(number, Base_discriminant[base], bits, signed);
        return v === undefined ? Err(ConversionErrorKind.InvalidLiteralKind) : Ok(v);
      }
      return Err(ConversionErrorKind.InvalidLiteralKind);
    });
  }

  // float_values! { .. }
  /// Returns the unescaped `f16` value if the literal is a `f16` or if it's an "unmarked" float which doesn't overflow.
  f16_value(): Result<number, ConversionErrorKind> {
    return unported("proc_macro::Literal::f16_value (`f16::from_str`: no f16 in src/std)");
  }
  /// Returns the unescaped `f32` value if the literal is a `f32` or if it's an "unmarked" float which doesn't overflow.
  f32_value(): Result<number, ConversionErrorKind> {
    return unported("proc_macro::Literal::f32_value (`f32::from_str`: correctly rounded f32 parsing not in src/std)");
  }
  /// Returns the unescaped `f64` value if the literal is a `f64` or if it's an "unmarked" float which doesn't overflow.
  f64_value(): Result<number, ConversionErrorKind> {
    if (!LitKind_eq(this._0.kind, LitKind.Float)) {
      return Err(ConversionErrorKind.InvalidLiteralKind);
    }
    return this.with_symbol_and_suffix((symbol, suffix): Result<number, ConversionErrorKind> => {
      if (suffix === "f64" || suffix === "") {
        const number = strip_underscores(symbol);
        const v = f64_from_str(number);
        return v === undefined ? Err(ConversionErrorKind.InvalidLiteralKind) : Ok(v);
      }
      return Err(ConversionErrorKind.InvalidLiteralKind);
    });
    // FIXME: `f128` doesn't implement `FromStr` for the moment so we cannot obtain it from
    // a `&str`. To be uncommented when it's added.
    // f128 => f128_value,
  }

  /// Parse a single literal from its stringified representation.
  ///
  /// In order to parse successfully, the input string must not contain anything
  /// but the literal token. Specifically, it must not contain whitespace or
  /// comments in addition to the literal.
  ///
  /// The resulting literal token will have a `Span::call_site()` span.
  ///
  /// NOTE: some errors may cause panics instead of returning `LexError`. We
  /// reserve the right to change these errors into `LexError`s later.
  // std: library/proc_macro/src/lib.rs:1855 from_str
  static from_str(src: string): Result<Literal, LexError> {
    const r = BridgeMethods.literal_from_str(src);
    if (r.$ === "Ok") return Ok(new Literal(r._0));
    return Err(new LexError(r._0));
  }

  /// Prints the literal as a string that should be losslessly convertible
  /// back into the same literal (except for possible rounding for floating point literals).
  // std: library/proc_macro/src/lib.rs:1867 fmt
  to_string(): string {
    return this.with_stringify_parts((parts) => {
      let f = "";
      for (const part of parts) {
        f += part;
      }
      return f;
    });
  }
}

// std: library/proc_macro/src/lib.rs:1879 fmt
export const debug_Literal: Debug<Literal> = (v, f) =>
  debug_struct(f, "Literal", [
    // format the kind on one line even in {:#?} mode
    ["kind", debug_LitKind(v._0.kind, PLAIN)],
    ["symbol", debug_client_Symbol(v._0.symbol, f)],
    // format `Some("...")` on one line even in {:#?} mode
    ["suffix", debug_option(v._0.suffix, PLAIN, debug_client_Symbol)],
    ["span", debug_client_Span(v._0.span, f)],
  ]);

/** `suffixed_int_literals!` body (lib.rs:1261). */
function suffixed_int_literal(n: number | bigint, kind: string): Literal {
  return new Literal({
    kind: LitKind.Integer,
    symbol: client_Symbol.new(String(n)),
    suffix: client_Symbol.new(kind),
    span: Span.call_site()._0,
  });
}

/** `unsuffixed_int_literals!` body (lib.rs:1286). */
function unsuffixed_int_literal(n: number | bigint): Literal {
  return new Literal({
    kind: LitKind.Integer,
    symbol: client_Symbol.new(String(n)),
    suffix: undefined,
    span: Span.call_site()._0,
  });
}

function as_number(r: Result<bigint, ConversionErrorKind>): Result<number, ConversionErrorKind> {
  return r.$ === "Ok" ? Ok(Number(r._0)) : r;
}

/**
 * PORT: `<f32 as Display>::fmt` (shortest round-trip digits, no exponent). src/std/fmt.ts has the f32 spec but
 * exports only `debug_f32`; `display_f64` of the widened value is not the same digits.
 */
function display_f32(_n: number): string {
  return unported("<f32 as Display>::fmt (src/std/fmt.ts exports no display_f32)");
}

/** `<f64 as Display>::fmt` without precision. */
function display_f64(n: number): string {
  return display_f64_std(n);
}

/**
 * PORT: `{integer}::from_str_radix(src, radix)` (library/core/src/num/mod.rs `from_ascii_radix`) for a `bits`-wide
 * integer, `undefined` for every `ParseIntError`: empty input, a lone sign, a `-` on an unsigned type, a digit not
 * valid in `radix`, or overflow.
 */
function int_from_str_radix(src: string, radix: number, bits: number, signed: boolean): bigint | undefined {
  if (src.length === 0) return undefined;
  let is_positive = true;
  let digits = src;
  const c0 = src.charCodeAt(0);
  if ((c0 === 0x2b || c0 === 0x2d) && src.length === 1) return undefined;
  if (c0 === 0x2b) {
    digits = src.slice(1);
  } else if (c0 === 0x2d && signed) {
    is_positive = false;
    digits = src.slice(1);
  }
  let v = 0n;
  const r = BigInt(radix);
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i);
    let d: number;
    if (c >= 0x30 && c <= 0x39) d = c - 0x30;
    else if (c >= 0x61 && c <= 0x7a) d = c - 0x61 + 10;
    else if (c >= 0x41 && c <= 0x5a) d = c - 0x41 + 10;
    else return undefined;
    if (d >= radix) return undefined;
    v = v * r + BigInt(d);
  }
  if (!is_positive) v = -v;
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  if (v < min || v > max) return undefined;
  return v;
}

/**
 * PORT: `<f64 as FromStr>::from_str` (library/core/src/num/dec2flt): an optional sign, then `inf` / `infinity` /
 * `nan` (ASCII case-insensitive) or decimal digits with an optional `.` (at least one digit) and an optional
 * `e`/`E` exponent with digits. JS `Number` of such a string is correctly rounded, as dec2flt is.
 */
function f64_from_str(src: string): number | undefined {
  let s = src;
  let neg = false;
  if (s.startsWith("+") || s.startsWith("-")) {
    neg = s.startsWith("-");
    s = s.slice(1);
  }
  const lower = s.toLowerCase();
  if (lower === "inf" || lower === "infinity") return neg ? -Infinity : Infinity;
  if (lower === "nan") return NaN;
  if (!/^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(s)) return undefined;
  const v = Number(s);
  return neg ? -v : v;
}

// std-type: library/proc_macro/src/lib.rs:1789 Base
type Base = "Decimal" | "Binary" | "Octal" | "Hexadecimal";
const Base_discriminant: Record<Base, number> = { Decimal: 10, Binary: 2, Octal: 8, Hexadecimal: 16 };

// std: library/proc_macro/src/lib.rs:1796 parse_number
function parse_number(value: string): [string, Base] {
  const bytes = utf8(value);
  if (bytes.length === 0) {
    return ["0", "Decimal"];
  }
  const first_digit = bytes[0]!;
  if (bytes.length === 1) {
    return [value, "Decimal"];
  }
  const second_digit = bytes[1]!;

  let base: Base = "Decimal";
  if (first_digit === 0x30) {
    // Attempt to parse encoding base.
    switch (second_digit) {
      case 0x62:
        base = "Binary";
        break;
      case 0x6f:
        base = "Octal";
        break;
      case 0x78:
        base = "Hexadecimal";
        break;
      default:
        break;
    }
  }

  const offset = base === "Decimal" ? 0 : 2;

  return [value.slice(offset), base];
}

// std: library/proc_macro/src/lib.rs:1827 strip_underscores
function strip_underscores(value_s: string): string {
  const value = utf8(value_s);
  if (value.every((c) => c !== 0x5f && c !== 0x66)) {
    return value_s;
  }
  let output = "";
  for (const c of value) {
    if (c !== 0x5f) {
      // PORT: `c as char` of a UTF-8 byte (Latin-1 reinterpretation, as upstream).
      output += String.fromCharCode(c);
    }
  }
  return output;
}

/// Functionality for adding environment state to the build dependency info.
// pub mod tracked {
export const tracked = {
  /// Retrieve an environment variable and add it to build dependency info.
  /// The build system executing the compiler will know that the variable was accessed during
  /// compilation, and will be able to rerun the build when the value of that variable changes.
  /// Besides the dependency tracking this function should be equivalent to `env::var` from the
  /// standard library, except that the argument must be UTF-8.
  // std: library/proc_macro/src/lib.rs:1910 env_var
  // PORT: `env::var(key)`: `Err(VarError::NotPresent)` when unset. A non-UTF-8 value (`NotUnicode`) cannot be
  // told apart through `process.env`.
  env_var(key: string): Result<string, "NotPresent"> {
    const v = process.env[key];
    const value: Result<string, "NotPresent"> = v === undefined ? Err("NotPresent") : Ok(v);
    BridgeMethods.track_env_var(key, value.$ === "Ok" ? value._0 : undefined);
    return value;
  },

  /// Track a file or directory explicitly.
  ///
  /// Commonly used for tracking asset preprocessing.
  // std: library/proc_macro/src/lib.rs:1921 path
  // PORT: `P: AsRef<Path>` is the path string (`to_str().unwrap()` of a UTF-8 path).
  path(path: string): void {
    BridgeMethods.track_path(path);
  },
};
// }

