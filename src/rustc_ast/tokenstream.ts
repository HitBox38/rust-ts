// Port of compiler/rustc_ast/src/tokenstream.rs
//! # Token Streams
//!
//! `TokenStream`s represent syntactic objects before they are converted into ASTs.
//! A `TokenStream` is, roughly speaking, a sequence of [`TokenTree`]s,
//! which are themselves a single [`Token`] or a `Delimited` subsequence of tokens.
//
// Types and derived Debug impls are generated into tokenstream.gen.ts (tools/codegen/types.ts).
// This module holds the manual `impl Debug`; the other functions are not ported yet.
// PORT: `TokenStreamIter` (wraps `std::slice::Iter<TokenTree>`) is skipped by the generator; the
// tokenstream port defines it here as a class.
import { type Debug, PLAIN } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { type AttrTokenStream, debug_AttrTokenStream, type LazyAttrTokenStream } from "./tokenstream.gen.ts";

export * from "./tokenstream.gen.ts";

// PORT: `LazyAttrTokenStream::to_attr_token_stream` (tokenstream.rs:137) is part of the
// tokenstream port, not of this types lane.
const to_attr_token_stream = (_v: LazyAttrTokenStream): AttrTokenStream =>
  unported("rustc_ast::tokenstream::LazyAttrTokenStream::to_attr_token_stream");

// rustc: compiler/rustc_ast/src/tokenstream.rs:143 fmt
// PORT: `write!(f, ..)` formats its arguments with a fresh `Formatter` (no `{:#?}` flag), hence `PLAIN`.
export const debug_LazyAttrTokenStream: Debug<LazyAttrTokenStream> = (v, _f) =>
  `LazyAttrTokenStream(${debug_AttrTokenStream(to_attr_token_stream(v), PLAIN)})`;
