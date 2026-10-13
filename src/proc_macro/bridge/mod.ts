// Port of library/proc_macro/src/bridge/mod.rs (subset: the plain data types).
//
//! Internal interface for communicating between a `proc_macro` client
//! (a proc macro crate) and a `proc_macro` server (a compiler front-end).
//!
//! Serialization (with C ABI buffers) and unique integer handles are employed
//! to allow safely interfacing between two copies of `proc_macro` built
//! (from the same source) by different compilers with potentially mismatching
//! Rust ABIs (e.g., stage0/bin/rustc vs stage1/bin/rustc during bootstrap).
//
// PORT: only the types the server side converts to and from are ported (M2). The RPC machinery
// (`with_api!`'s `ApiTags`, `BridgeConfig`, `Buffer`, `Mark`/`Marked`, `rpc_encode_decode!`, `compound_traits!`,
// the `arena`/`buffer`/`closure`/`fxhash`/`handle`/`rpc`/`selfless_reify`/`symbol` modules) exists to move these
// values between a proc-macro dylib and the compiler; it is M6 (decision D6). The `with_api!` method list is
// the `Server` interface in server.ts. Generic parameters (`TokenStream`, `Span`, `Symbol`) are kept.

import { type Debug, debug_int, debug_str, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import type { Delimiter } from "../lib.ts";
import { debug_Level, type Level } from "../diagnostic.ts";

export * as client from "./client.ts";
export * as server from "./server.ts";
export { PanicMessage } from "./panic_message.ts";

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

// std-type: library/proc_macro/src/bridge/mod.rs:369 Group
export interface Group<TokenStream, Span> {
  delimiter: Delimiter;
  stream: TokenStream | undefined;
  span: DelimSpan<Span>;
}

// std-type: library/proc_macro/src/bridge/mod.rs:378 Punct
export interface Punct<Span> {
  /** `u8` */
  ch: number;
  joint: boolean;
  span: Span;
}

// std-type: library/proc_macro/src/bridge/mod.rs:387 Ident
export interface Ident<Span, Symbol> {
  sym: Symbol;
  kind: IdentKind;
  span: Span;
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

// std-type: library/proc_macro/src/bridge/mod.rs:421 Literal
export interface Literal<Span, Symbol> {
  kind: LitKind;
  symbol: Symbol;
  suffix: Symbol | undefined;
  span: Span;
}

// std-type: library/proc_macro/src/bridge/mod.rs:431 TokenTree
export type TokenTree<TokenStream, Span, Symbol> =
  | { readonly $: "Group"; _0: Group<TokenStream, Span> }
  | { readonly $: "Punct"; _0: Punct<Span> }
  | { readonly $: "Ident"; _0: Ident<Span, Symbol> }
  | { readonly $: "Literal"; _0: Literal<Span, Symbol> };

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

/// Globals provided alongside the initial inputs for a macro expansion.
/// Provides values such as spans which are used frequently to avoid RPC.
// std-type: library/proc_macro/src/bridge/mod.rs:462 ExpnGlobals
export interface ExpnGlobals<Span> {
  def_site: Span;
  call_site: Span;
  mixed_site: Span;
}
