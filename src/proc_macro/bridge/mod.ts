// Port of library/proc_macro/src/bridge/mod.rs
//
//! Internal interface for communicating between a `proc_macro` client
//! (a proc macro crate) and a `proc_macro` server (a compiler front-end).
//!
//! Serialization (with C ABI buffers) and unique integer handles are employed
//! to allow safely interfacing between two copies of `proc_macro` built
//! (from the same source) by different compilers with potentially mismatching
//! Rust ABIs (e.g., stage0/bin/rustc vs stage1/bin/rustc during bootstrap).
//
// PORT: `with_api!` is the method list; its three expansions are written out in upstream order: `ApiTags` below
// (`declare_tags`), the `Server` interface and `Dispatcher.dispatch` in server.ts (`define_server`,
// `define_dispatcher`) and `Methods` in client.ts (`define_client_side`, whose fns carry the markers of the
// `with_api!` lines). `rpc_encode_decode!` / `mark_compound!` / `compound_traits!` invocations are expanded by
// hand where they are invoked (see rpc.ts for the codec conventions). Generic parameters (`TokenStream`, `Span`,
// `Symbol`) are kept.
//
// PORT: `Marked<T, M>` (a `T` tagged with a phantom marker type so that trait impls for the server's associated
// types cannot overlap) is `T` itself: the TS codecs are chosen explicitly at each call, so the marker has no role
// left and every `Mark` impl is an identity (`&Marked`'s `mark` stays `unreachable!()`).

import { type Debug, debug_int, debug_str, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Delimiter } from "../lib.ts";
import { debug_Level, type Level } from "../diagnostic.ts";
import type { Buffer } from "./buffer.ts";
import type { Closure } from "./closure.ts";
import {
  type Decode,
  decode_bool,
  decode_String,
  decode_u8,
  decode_Vec,
  type Encode,
  encode_bool,
  encode_String,
  encode_u8,
  encode_Vec,
} from "./rpc.ts";
import type { Bound, Range } from "./server.ts";

export * as client from "./client.ts";
// PORT: `pub mod server;` is a type-only re-export. server.rs's `impl client::Client { fn run1/run2 }` makes
// server.ts an extension module of client.ts (PORTING §5 "Methods defined in another file"), and client.ts
// value-imports this module, so evaluating server.ts from here ran its `Client.prototype.run1 = ..` before client.ts
// defined `Client` whenever client.ts (or symbol.ts / diagnostic.ts) was the first module loaded. The crate root
// (lib.ts) imports server.ts for its side effects; other users value-import it directly.
export type * as server from "./server.ts";
export { Buffer } from "./buffer.ts";
export { PanicMessage } from "./panic_message.ts";

/// Configuration for establishing an active connection between a server and a
/// client.  The server creates the bridge config (`run_server` in `server.rs`),
/// then passes it to the client through the function pointer in the `run` field
/// of `client::Client`. The client constructs a local `Bridge` from the config
/// in TLS during its execution (`Bridge::{enter, with}` in `client.rs`).
// std-type: library/proc_macro/src/bridge/mod.rs:120 BridgeConfig
export interface BridgeConfig {
  /// Buffer used to pass initial input to the client.
  input: Buffer;

  /// Server-side function that the client uses to make requests.
  dispatch: Closure;

  /// If 'true', always invoke the default panic hook
  force_show_panics: boolean;
}

// with_api!(declare_tags, __, __, __);
// std-type: library/proc_macro/src/bridge/mod.rs:139 ApiTags
export type ApiTags =
  | "track_env_var"
  | "track_path"
  | "literal_from_str"
  | "emit_diagnostic"
  | "ts_drop"
  | "ts_clone"
  | "ts_is_empty"
  | "ts_expand_expr"
  | "ts_from_str"
  | "ts_to_string"
  | "ts_from_token_tree"
  | "ts_concat_trees"
  | "ts_concat_streams"
  | "ts_into_trees"
  | "span_debug"
  | "span_parent"
  | "span_source"
  | "span_byte_range"
  | "span_start"
  | "span_end"
  | "span_line"
  | "span_column"
  | "span_file"
  | "span_local_file"
  | "span_join"
  | "span_subspan"
  | "span_resolved_at"
  | "span_source_text"
  | "span_save_span"
  | "span_recover_proc_macro_span"
  | "symbol_normalize_and_validate_ident";
/** The variants of `ApiTags` in declaration order: a variant's index is its `u8` tag on the wire. */
export const ApiTags_variants: readonly ApiTags[] = [
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
// rpc_encode_decode!(enum ApiTags { $($method),* });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_ApiTags<S>(self: ApiTags, w: Buffer, s: S): void {
  encode_tag(ApiTags_variants, self, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_ApiTags<S>(r: MutRef<Uint8Array>, s: S): ApiTags {
  return decode_tag(ApiTags_variants, r, s);
}

/// Helper to wrap associated types to allow trait impl dispatch.
/// That is, normally a pair of impls for `T::Foo` and `T::Bar`
/// can overlap, but if the impls are, instead, on types like
/// `Marked<T::Foo, Foo>` and `Marked<T::Bar, Bar>`, they can't.
// std-type: library/proc_macro/src/bridge/mod.rs:151 Mark
export interface Mark<Self, Unmarked> {
  // std: library/proc_macro/src/bridge/mod.rs:153 mark
  mark(unmarked: Unmarked): Self;
  // std: library/proc_macro/src/bridge/mod.rs:154 unmark
  unmark(self: Self): Unmarked;
}

// impl<T, M> Mark for Marked<T, M>
export const Mark_Marked = {
  // std: library/proc_macro/src/bridge/mod.rs:166 mark
  mark<T>(unmarked: T): T {
    return unmarked;
  },
  // std: library/proc_macro/src/bridge/mod.rs:170 unmark
  unmark<T>(self: T): T {
    return self;
  },
};

// impl<'a, T> Mark for &'a Marked<T, client::TokenStream>
export const Mark_ref_Marked = {
  // std: library/proc_macro/src/bridge/mod.rs:176 mark
  mark<T>(_: T): T {
    return unreachable();
  },
  // std: library/proc_macro/src/bridge/mod.rs:180 unmark
  unmark<T>(self: T): T {
    return self;
  },
};

// impl<T: Mark> Mark for Vec<T>
export const Mark_Vec = {
  // std: library/proc_macro/src/bridge/mod.rs:188 mark
  mark<T>(unmarked: T[]): T[] {
    // Should be a no-op due to std's in-place collect optimizations.
    return unmarked;
  },
  // std: library/proc_macro/src/bridge/mod.rs:193 unmark
  unmark<T>(self: T[]): T[] {
    // Should be a no-op due to std's in-place collect optimizations.
    return self;
  },
};

// mark_noop! { (), bool, &'_ str, String, u8, usize, Delimiter, LitKind, IdentKind, Level, Bound<usize>, Range<usize> }
export const Mark_noop = {
  // std: library/proc_macro/src/bridge/mod.rs:205 mark
  mark<T>(unmarked: T): T {
    return unmarked;
  },
  // std: library/proc_macro/src/bridge/mod.rs:209 unmark
  unmark<T>(self: T): T {
    return self;
  },
};

// rpc_encode_decode!(enum Delimiter { Parenthesis, Brace, Bracket, None });
const Delimiter_variants: readonly Delimiter[] = ["Parenthesis", "Brace", "Bracket", "None"];
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_Delimiter<S>(self: Delimiter, w: Buffer, s: S): void {
  encode_tag(Delimiter_variants, self, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_Delimiter<S>(r: MutRef<Uint8Array>, s: S): Delimiter {
  return decode_tag(Delimiter_variants, r, s);
}

// rpc_encode_decode!(enum Level { Error, Warning, Note, Help });
const Level_variants: readonly Level[] = ["Error", "Warning", "Note", "Help"];
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_Level<S>(self: Level, w: Buffer, s: S): void {
  encode_tag(Level_variants, self, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_Level<S>(r: MutRef<Uint8Array>, s: S): Level {
  return decode_tag(Level_variants, r, s);
}

// std-type: library/proc_macro/src/bridge/mod.rs:249 LitKind
export type LitKind =
  | { readonly $: "Byte" }
  | { readonly $: "Char" }
  | { readonly $: "Integer" }
  | { readonly $: "Float" }
  | { readonly $: "Str" }
  | { readonly $: "StrRaw"; _0: number }
  | { readonly $: "ByteStr" }
  | { readonly $: "ByteStrRaw"; _0: number }
  | { readonly $: "CStr" }
  | { readonly $: "CStrRaw"; _0: number }
  // This should have an `ErrorGuaranteed`, except that type isn't available
  // in this crate. (Imagine it is there.) Hence the `WithGuar` suffix. Must
  // only be constructed in `LitKind::from_internal`, where an
  // `ErrorGuaranteed` is available.
  | { readonly $: "ErrWithGuar" };
/** Unit variants of `LitKind`, shared frozen singletons. */
export const LitKind = {
  Byte: Object.freeze({ $: "Byte" as const }),
  Char: Object.freeze({ $: "Char" as const }),
  Integer: Object.freeze({ $: "Integer" as const }),
  Float: Object.freeze({ $: "Float" as const }),
  Str: Object.freeze({ $: "Str" as const }),
  ByteStr: Object.freeze({ $: "ByteStr" as const }),
  CStr: Object.freeze({ $: "CStr" as const }),
  ErrWithGuar: Object.freeze({ $: "ErrWithGuar" as const }),
};
/** `#[derive(Debug)]` */
export const debug_LitKind: Debug<LitKind> = (v, f) => {
  switch (v.$) {
    case "StrRaw":
    case "ByteStrRaw":
    case "CStrRaw":
      return debug_tuple(f, v.$, [debug_int(v._0, f)]);
    default:
      return v.$;
  }
};
/** `#[derive(PartialEq)]` */
export function LitKind_eq(a: LitKind, b: LitKind): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "StrRaw":
    case "ByteStrRaw":
    case "CStrRaw":
      return a._0 === (b as typeof a)._0;
    default:
      return true;
  }
}

// rpc_encode_decode!(enum LitKind { Byte, Char, Integer, Float, Str, StrRaw(n), ByteStr, ByteStrRaw(n), CStr,
// CStrRaw(n), ErrWithGuar });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_LitKind<S>(self: LitKind, w: Buffer, s: S): void {
  switch (self.$) {
    case "Byte":
      encode_u8(0, w, s);
      break;
    case "Char":
      encode_u8(1, w, s);
      break;
    case "Integer":
      encode_u8(2, w, s);
      break;
    case "Float":
      encode_u8(3, w, s);
      break;
    case "Str":
      encode_u8(4, w, s);
      break;
    case "StrRaw":
      encode_u8(5, w, s);
      encode_u8(self._0, w, s);
      break;
    case "ByteStr":
      encode_u8(6, w, s);
      break;
    case "ByteStrRaw":
      encode_u8(7, w, s);
      encode_u8(self._0, w, s);
      break;
    case "CStr":
      encode_u8(8, w, s);
      break;
    case "CStrRaw":
      encode_u8(9, w, s);
      encode_u8(self._0, w, s);
      break;
    case "ErrWithGuar":
      encode_u8(10, w, s);
      break;
  }
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_LitKind<S>(r: MutRef<Uint8Array>, s: S): LitKind {
  switch (decode_u8(r, s)) {
    case 0:
      return LitKind.Byte;
    case 1:
      return LitKind.Char;
    case 2:
      return LitKind.Integer;
    case 3:
      return LitKind.Float;
    case 4:
      return LitKind.Str;
    case 5: {
      const n = decode_u8(r, s);
      return { $: "StrRaw", _0: n };
    }
    case 6:
      return LitKind.ByteStr;
    case 7: {
      const n = decode_u8(r, s);
      return { $: "ByteStrRaw", _0: n };
    }
    case 8:
      return LitKind.CStr;
    case 9: {
      const n = decode_u8(r, s);
      return { $: "CStrRaw", _0: n };
    }
    case 10:
      return LitKind.ErrWithGuar;
    default:
      return unreachable();
  }
}

// macro_rules! mark_compound: `struct` arm (the impls for DelimSpan, Group, Punct, Ident, Literal, Diagnostic,
// ExpnGlobals below).
export const Mark_compound_struct = {
  // std: library/proc_macro/src/bridge/mod.rs:288 mark
  mark<T>(unmarked: T): T {
    return unmarked;
  },
  // std: library/proc_macro/src/bridge/mod.rs:294 unmark
  unmark<T>(self: T): T {
    return self;
  },
};

// macro_rules! mark_compound: `enum` arm (the impls for Option, Result, TokenTree below).
export const Mark_compound_enum = {
  // std: library/proc_macro/src/bridge/mod.rs:305 mark
  mark<T>(unmarked: T): T {
    return unmarked;
  },
  // std: library/proc_macro/src/bridge/mod.rs:313 unmark
  unmark<T>(self: T): T {
    return self;
  },
};

// rpc_encode_decode!(enum Bound<T> { Included(x), Excluded(x), Unbounded });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_Bound<S>(self: Bound, w: Buffer, s: S, encode_T: Encode<number, S>): void {
  switch (self.$) {
    case "Included":
      encode_u8(0, w, s);
      encode_T(self._0, w, s);
      break;
    case "Excluded":
      encode_u8(1, w, s);
      encode_T(self._0, w, s);
      break;
    case "Unbounded":
      encode_u8(2, w, s);
      break;
  }
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_Bound<S>(r: MutRef<Uint8Array>, s: S, decode_T: Decode<number, S>): Bound {
  switch (decode_u8(r, s)) {
    case 0: {
      const x = decode_T(r, s);
      return { $: "Included", _0: x };
    }
    case 1: {
      const x = decode_T(r, s);
      return { $: "Excluded", _0: x };
    }
    case 2:
      return { $: "Unbounded" };
    default:
      return unreachable();
  }
}

// compound_traits!(enum Option<T> { Some(t), None });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_Option<T, S>(self: T | undefined, w: Buffer, s: S, encode_T: Encode<T, S>): void {
  if (self !== undefined) {
    encode_u8(0, w, s);
    encode_T(self, w, s);
  } else {
    encode_u8(1, w, s);
  }
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_Option<T, S>(r: MutRef<Uint8Array>, s: S, decode_T: Decode<T, S>): T | undefined {
  switch (decode_u8(r, s)) {
    case 0: {
      const t = decode_T(r, s);
      return t;
    }
    case 1:
      return undefined;
    default:
      return unreachable();
  }
}

// compound_traits!(enum Result<T, E> { Ok(t), Err(e) });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_Result<T, E, S>(self: Result<T, E>, w: Buffer, s: S, encode_T: Encode<T, S>, encode_E: Encode<E, S>): void {
  switch (self.$) {
    case "Ok":
      encode_u8(0, w, s);
      encode_T(self._0, w, s);
      break;
    case "Err":
      encode_u8(1, w, s);
      encode_E(self._0, w, s);
      break;
  }
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_Result<T, E, S>(r: MutRef<Uint8Array>, s: S, decode_T: Decode<T, S>, decode_E: Decode<E, S>): Result<T, E> {
  switch (decode_u8(r, s)) {
    case 0: {
      const t = decode_T(r, s);
      return Ok(t);
    }
    case 1: {
      const e = decode_E(r, s);
      return Err(e);
    }
    default:
      return unreachable();
  }
}

// std-type: library/proc_macro/src/bridge/mod.rs:354 DelimSpan
export class DelimSpan<Span> {
  constructor(
    public open: Span,
    public close: Span,
    public entire: Span,
  ) {}

  // std: library/proc_macro/src/bridge/mod.rs:361 from_single
  static from_single<Span>(span: Span): DelimSpan<Span> {
    return new DelimSpan(span, span, span);
  }
}

// compound_traits!(struct DelimSpan<Span> { open, close, entire });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_DelimSpan<Span, S>(self: DelimSpan<Span>, w: Buffer, s: S, encode_Span: Encode<Span, S>): void {
  encode_Span(self.open, w, s);
  encode_Span(self.close, w, s);
  encode_Span(self.entire, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_DelimSpan<Span, S>(r: MutRef<Uint8Array>, s: S, decode_Span: Decode<Span, S>): DelimSpan<Span> {
  const open = decode_Span(r, s);
  const close = decode_Span(r, s);
  const entire = decode_Span(r, s);
  return new DelimSpan(open, close, entire);
}

// std-type: library/proc_macro/src/bridge/mod.rs:369 Group
export interface Group<TokenStream, Span> {
  delimiter: Delimiter;
  stream: TokenStream | undefined;
  span: DelimSpan<Span>;
}

// compound_traits!(struct Group<TokenStream, Span> { delimiter, stream, span });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Group<TokenStream, Span, S>(
  self: Group<TokenStream, Span>,
  w: Buffer,
  s: S,
  encode_TokenStream: Encode<TokenStream, S>,
  encode_Span: Encode<Span, S>,
): void {
  encode_Delimiter(self.delimiter, w, s);
  encode_Option(self.stream, w, s, encode_TokenStream);
  encode_DelimSpan(self.span, w, s, encode_Span);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Group<TokenStream, Span, S>(
  r: MutRef<Uint8Array>,
  s: S,
  decode_TokenStream: Decode<TokenStream, S>,
  decode_Span: Decode<Span, S>,
): Group<TokenStream, Span> {
  const delimiter = decode_Delimiter(r, s);
  const stream = decode_Option(r, s, decode_TokenStream);
  const span = decode_DelimSpan(r, s, decode_Span);
  return { delimiter, stream, span };
}

// std-type: library/proc_macro/src/bridge/mod.rs:378 Punct
export interface Punct<Span> {
  /** `u8` */
  ch: number;
  joint: boolean;
  span: Span;
}

// compound_traits!(struct Punct<Span> { ch, joint, span });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Punct<Span, S>(self: Punct<Span>, w: Buffer, s: S, encode_Span: Encode<Span, S>): void {
  encode_u8(self.ch, w, s);
  encode_bool(self.joint, w, s);
  encode_Span(self.span, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Punct<Span, S>(r: MutRef<Uint8Array>, s: S, decode_Span: Decode<Span, S>): Punct<Span> {
  const ch = decode_u8(r, s);
  const joint = decode_bool(r, s);
  const span = decode_Span(r, s);
  return { ch, joint, span };
}

// std-type: library/proc_macro/src/bridge/mod.rs:387 Ident
export interface Ident<Span, Symbol> {
  sym: Symbol;
  kind: IdentKind;
  span: Span;
}

// compound_traits!(struct Ident<Span, Symbol> { sym, kind, span });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Ident<Span, Symbol, S>(
  self: Ident<Span, Symbol>,
  w: Buffer,
  s: S,
  encode_Span: Encode<Span, S>,
  encode_Symbol: Encode<Symbol, S>,
): void {
  encode_Symbol(self.sym, w, s);
  encode_IdentKind(self.kind, w, s);
  encode_Span(self.span, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Ident<Span, Symbol, S>(
  r: MutRef<Uint8Array>,
  s: S,
  decode_Span: Decode<Span, S>,
  decode_Symbol: Decode<Symbol, S>,
): Ident<Span, Symbol> {
  const sym = decode_Symbol(r, s);
  const kind = decode_IdentKind(r, s);
  const span = decode_Span(r, s);
  return { sym, kind, span };
}

// std-type: library/proc_macro/src/bridge/mod.rs:396 IdentKind
export type IdentKind = "Normal" | "Raw" | "ForcedKeyword";
export const IdentKind = {
  Normal: "Normal",
  Raw: "Raw",
  ForcedKeyword: "ForcedKeyword",

  // std: library/proc_macro/src/bridge/mod.rs:403 prefix
  prefix(self: IdentKind): string | undefined {
    switch (self) {
      case "Normal":
        return undefined;
      case "Raw":
        return "r#";
      case "ForcedKeyword":
        return "k#";
    }
  },
} as const;

// rpc_encode_decode!(enum IdentKind { Normal, Raw, ForcedKeyword });
const IdentKind_variants: readonly IdentKind[] = ["Normal", "Raw", "ForcedKeyword"];
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_IdentKind<S>(self: IdentKind, w: Buffer, s: S): void {
  encode_tag(IdentKind_variants, self, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_IdentKind<S>(r: MutRef<Uint8Array>, s: S): IdentKind {
  return decode_tag(IdentKind_variants, r, s);
}

// std-type: library/proc_macro/src/bridge/mod.rs:421 Literal
export interface Literal<Span, Symbol> {
  kind: LitKind;
  symbol: Symbol;
  suffix: Symbol | undefined;
  span: Span;
}

// compound_traits!(struct Literal<Span, Symbol> { kind, symbol, suffix, span });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Literal<Span, Symbol, S>(
  self: Literal<Span, Symbol>,
  w: Buffer,
  s: S,
  encode_Span: Encode<Span, S>,
  encode_Symbol: Encode<Symbol, S>,
): void {
  encode_LitKind(self.kind, w, s);
  encode_Symbol(self.symbol, w, s);
  encode_Option(self.suffix, w, s, encode_Symbol);
  encode_Span(self.span, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Literal<Span, Symbol, S>(
  r: MutRef<Uint8Array>,
  s: S,
  decode_Span: Decode<Span, S>,
  decode_Symbol: Decode<Symbol, S>,
): Literal<Span, Symbol> {
  const kind = decode_LitKind(r, s);
  const symbol = decode_Symbol(r, s);
  const suffix = decode_Option(r, s, decode_Symbol);
  const span = decode_Span(r, s);
  return { kind, symbol, suffix, span };
}

// std-type: library/proc_macro/src/bridge/mod.rs:431 TokenTree
export type TokenTree<TokenStream, Span, Symbol> =
  | { readonly $: "Group"; _0: Group<TokenStream, Span> }
  | { readonly $: "Punct"; _0: Punct<Span> }
  | { readonly $: "Ident"; _0: Ident<Span, Symbol> }
  | { readonly $: "Literal"; _0: Literal<Span, Symbol> };

// compound_traits!(enum TokenTree<TokenStream, Span, Symbol> { Group(tt), Punct(tt), Ident(tt), Literal(tt) });
// std: library/proc_macro/src/bridge/rpc.rs:64 encode
export function encode_TokenTree<TokenStream, Span, Symbol, S>(
  self: TokenTree<TokenStream, Span, Symbol>,
  w: Buffer,
  s: S,
  encode_TokenStream: Encode<TokenStream, S>,
  encode_Span: Encode<Span, S>,
  encode_Symbol: Encode<Symbol, S>,
): void {
  switch (self.$) {
    case "Group":
      encode_u8(0, w, s);
      encode_Group(self._0, w, s, encode_TokenStream, encode_Span);
      break;
    case "Punct":
      encode_u8(1, w, s);
      encode_Punct(self._0, w, s, encode_Span);
      break;
    case "Ident":
      encode_u8(2, w, s);
      encode_Ident(self._0, w, s, encode_Span, encode_Symbol);
      break;
    case "Literal":
      encode_u8(3, w, s);
      encode_Literal(self._0, w, s, encode_Span, encode_Symbol);
      break;
  }
}
// std: library/proc_macro/src/bridge/rpc.rs:78 decode
export function decode_TokenTree<TokenStream, Span, Symbol, S>(
  r: MutRef<Uint8Array>,
  s: S,
  decode_TokenStream: Decode<TokenStream, S>,
  decode_Span: Decode<Span, S>,
  decode_Symbol: Decode<Symbol, S>,
): TokenTree<TokenStream, Span, Symbol> {
  switch (decode_u8(r, s)) {
    case 0: {
      const tt = decode_Group(r, s, decode_TokenStream, decode_Span);
      return { $: "Group", _0: tt };
    }
    case 1: {
      const tt = decode_Punct(r, s, decode_Span);
      return { $: "Punct", _0: tt };
    }
    case 2: {
      const tt = decode_Ident(r, s, decode_Span, decode_Symbol);
      return { $: "Ident", _0: tt };
    }
    case 3: {
      const tt = decode_Literal(r, s, decode_Span, decode_Symbol);
      return { $: "Literal", _0: tt };
    }
    default:
      return unreachable();
  }
}

// std-type: library/proc_macro/src/bridge/mod.rs:448 Diagnostic
export interface Diagnostic<Span> {
  level: Level;
  message: string;
  spans: Span[];
  children: Diagnostic<Span>[];
}
/** `#[derive(Debug)]` (generic: the `Span` impl is passed in). */
export function debug_Diagnostic<Span>(v: Diagnostic<Span>, f: Fmt, debug_Span: Debug<Span>): string {
  return debug_struct(f, "Diagnostic", [
    ["level", debug_Level(v.level, f)],
    ["message", debug_str(v.message)],
    ["spans", debug_vec(v.spans, f, debug_Span)],
    ["children", debug_vec(v.children, f, (c, f2) => debug_Diagnostic(c, f2, debug_Span))],
  ]);
}

// compound_traits!(struct Diagnostic<Span> { level, message, spans, children });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Diagnostic<Span, S>(self: Diagnostic<Span>, w: Buffer, s: S, encode_Span: Encode<Span, S>): void {
  encode_Level(self.level, w, s);
  encode_String(self.message, w, s);
  encode_Vec(self.spans, w, s, encode_Span);
  encode_Vec(self.children, w, s, (c: Diagnostic<Span>, w2: Buffer, s2: S) => encode_Diagnostic(c, w2, s2, encode_Span));
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Diagnostic<Span, S>(r: MutRef<Uint8Array>, s: S, decode_Span: Decode<Span, S>): Diagnostic<Span> {
  const level = decode_Level(r, s);
  const message = decode_String(r, s);
  const spans = decode_Vec(r, s, decode_Span);
  const children = decode_Vec(r, s, (r2: MutRef<Uint8Array>, s2: S) => decode_Diagnostic(r2, s2, decode_Span));
  return { level, message, spans, children };
}

/// Globals provided alongside the initial inputs for a macro expansion.
/// Provides values such as spans which are used frequently to avoid RPC.
// std-type: library/proc_macro/src/bridge/mod.rs:462 ExpnGlobals
export interface ExpnGlobals<Span> {
  def_site: Span;
  call_site: Span;
  mixed_site: Span;
}

// compound_traits!(struct ExpnGlobals<Span> { def_site, call_site, mixed_site });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_ExpnGlobals<Span, S>(self: ExpnGlobals<Span>, w: Buffer, s: S, encode_Span: Encode<Span, S>): void {
  encode_Span(self.def_site, w, s);
  encode_Span(self.call_site, w, s);
  encode_Span(self.mixed_site, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_ExpnGlobals<Span, S>(r: MutRef<Uint8Array>, s: S, decode_Span: Decode<Span, S>): ExpnGlobals<Span> {
  const def_site = decode_Span(r, s);
  const call_site = decode_Span(r, s);
  const mixed_site = decode_Span(r, s);
  return { def_site, call_site, mixed_site };
}

// rpc_encode_decode!(struct Range<T> { start, end });
// std: library/proc_macro/src/bridge/rpc.rs:39 encode
export function encode_Range<S>(self: Range, w: Buffer, s: S, encode_T: Encode<number, S>): void {
  encode_T(self.start, w, s);
  encode_T(self.end, w, s);
}
// std: library/proc_macro/src/bridge/rpc.rs:48 decode
export function decode_Range<S>(r: MutRef<Uint8Array>, s: S, decode_T: Decode<number, S>): Range {
  const start = decode_T(r, s);
  const end = decode_T(r, s);
  return { start, end };
}

/**
 * `rpc_encode_decode!(enum ..)` for a fieldless enum: the tag is the variant's index as a `u8`.
 * PORT: upstream's `match self` is exhaustive; a value outside `variants` (ill-typed caller) is `unreachable!()`, as
 * in `decode_tag`, instead of encoding `indexOf`'s -1 as the byte 255.
 */
function encode_tag<T, S>(variants: readonly T[], self: T, w: Buffer, s: S): void {
  const tag = variants.indexOf(self);
  if (tag === -1) return unreachable();
  encode_u8(tag, w, s);
}

/** `rpc_encode_decode!(enum ..)` for a fieldless enum: an unknown tag is `unreachable!()`. */
function decode_tag<T, S>(variants: readonly T[], r: MutRef<Uint8Array>, s: S): T {
  const v = variants[decode_u8(r, s)];
  if (v === undefined) return unreachable();
  return v;
}
