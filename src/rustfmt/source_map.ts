// Port of src/tools/rustfmt/src/source_map.rs (lane rustfmt-contract-2).
//! This module contains utilities that work with the `SourceMap` from `libsyntax`/`syntex_syntax`.
//! This includes extension traits and methods for looking up spans and line ranges for AST nodes.
//
// An extension module (PORTING §5 "Methods defined in another file"): it attaches `SpanUtils` to `SnippetProvider`
// (visitor.rs), so the crate root imports it for its side effects after `visitor.ts` once that module exists. Until then
// `visitor.rs` and `comment.rs` are declared in contract_lib.d.ts (whose `SnippetProvider` lists these methods too).
import { BytePos, Span } from "../rustc_span/lib.ts";

import { FindUncommented_str } from "../rustfmt/comment.ts";
import type { LineRange } from "./config/file_lines.ts";
import { SnippetProvider } from "../rustfmt/visitor.ts";
import { panic, unported, unwrap } from "../std/panic.ts";
import { utf8, utf8_len } from "../std/str.ts";

const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** `&s[offset..]` for a UTF-8 byte `offset` into a JS string. PORT: rustfmt's text is a JS `string` (utils.ts), and
 *  `find_uncommented` returns a byte offset as upstream does. Upstream panics off a char boundary; the port stops there
 *  instead of guessing that panic's message (the offsets come from `find_uncommented` plus `needle.len()`, so they sit
 *  on boundaries). */
function str_from_byte(s: string, offset: number): string {
  if (offset === 0) return s;
  const b = utf8(s);
  if (offset > b.length || (offset < b.length && (b[offset]! & 0xc0) === 0x80)) {
    return unported("rustfmt source_map.rs: `str` slice panic off a char boundary or past the end");
  }
  return decoder.decode(b.subarray(offset));
}

/** `u32` wrapping arithmetic: rustfmt ships without overflow checks. */
function u32_wrapping(n: number): number {
  return n >>> 0;
}

export interface SpanUtils {
  // rustc: src/tools/rustfmt/src/source_map.rs:11 span_after
  span_after(original: Span, needle: string): BytePos;
  // rustc: src/tools/rustfmt/src/source_map.rs:12 span_after_last
  span_after_last(original: Span, needle: string): BytePos;
  // rustc: src/tools/rustfmt/src/source_map.rs:13 span_before
  span_before(original: Span, needle: string): BytePos;
  // rustc: src/tools/rustfmt/src/source_map.rs:14 span_before_last
  span_before_last(original: Span, needle: string): BytePos;
  // rustc: src/tools/rustfmt/src/source_map.rs:15 opt_span_after
  opt_span_after(original: Span, needle: string): BytePos | undefined;
  // rustc: src/tools/rustfmt/src/source_map.rs:16 opt_span_before
  opt_span_before(original: Span, needle: string): BytePos | undefined;
}

// PORT: implemented by `ParseSess` (parse/session.rs:284), as a method on that class.
export interface LineRangeUtils {
  /// Returns the `LineRange` that corresponds to `span` in `self`.
  ///
  /// # Panics
  ///
  /// Panics if `span` crosses a file boundary, which shouldn't happen.
  // rustc: src/tools/rustfmt/src/source_map.rs:25 lookup_line_range
  lookup_line_range(span: Span): LineRange;
}

// impl SpanUtils for SnippetProvider
declare module "../rustfmt/visitor.ts" {
  interface SnippetProvider {
    span_after(original: Span, needle: string): BytePos;
    span_after_last(original: Span, needle: string): BytePos;
    span_before(original: Span, needle: string): BytePos;
    span_before_last(original: Span, needle: string): BytePos;
    opt_span_after(original: Span, needle: string): BytePos | undefined;
    opt_span_before(original: Span, needle: string): BytePos | undefined;
  }
}

// rustc: src/tools/rustfmt/src/source_map.rs:29 span_after
SnippetProvider.prototype.span_after = function (this: SnippetProvider, original: Span, needle: string): BytePos {
  const r = this.opt_span_after(original, needle);
  if (r !== undefined) return r;
  return panic(`bad span: \`${needle}\`: \`${unwrap(this.span_to_snippet(original))}\``);
};

// rustc: src/tools/rustfmt/src/source_map.rs:39 span_after_last
SnippetProvider.prototype.span_after_last = function (this: SnippetProvider, original: Span, needle: string): BytePos {
  const snippet = unwrap(this.span_to_snippet(original));
  let offset = 0;

  for (;;) {
    const additional_offset = FindUncommented_str.find_uncommented(str_from_byte(snippet, offset), needle);
    if (additional_offset === undefined) break;
    offset += additional_offset + utf8_len(needle);
  }

  return BytePos.add(Span.lo(original), BytePos(u32_wrapping(offset)));
};

// rustc: src/tools/rustfmt/src/source_map.rs:50 span_before
SnippetProvider.prototype.span_before = function (this: SnippetProvider, original: Span, needle: string): BytePos {
  const r = this.opt_span_before(original, needle);
  if (r !== undefined) return r;
  return panic(`bad span: \`${needle}\`: \`${unwrap(this.span_to_snippet(original))}\``);
};

// rustc: src/tools/rustfmt/src/source_map.rs:60 span_before_last
SnippetProvider.prototype.span_before_last = function (this: SnippetProvider, original: Span, needle: string): BytePos {
  const snippet = unwrap(this.span_to_snippet(original));
  let offset = 0;

  for (;;) {
    const additional_offset = FindUncommented_str.find_uncommented(str_from_byte(snippet, offset), needle);
    if (additional_offset === undefined) break;
    offset += additional_offset + utf8_len(needle);
  }

  // PORT: `offset as u32 - 1` and `BytePos + BytePos` wrap in u32 (no overflow checks): with no match (`offset == 0`)
  // this is `lo - 1`.
  return BytePos(u32_wrapping(Span.lo(original) + u32_wrapping(offset - 1)));
};

// rustc: src/tools/rustfmt/src/source_map.rs:71 opt_span_after
SnippetProvider.prototype.opt_span_after = function (this: SnippetProvider, original: Span, needle: string): BytePos | undefined {
  const bytepos = this.opt_span_before(original, needle);
  return bytepos === undefined ? undefined : BytePos.add(bytepos, BytePos(u32_wrapping(utf8_len(needle))));
};

// rustc: src/tools/rustfmt/src/source_map.rs:76 opt_span_before
SnippetProvider.prototype.opt_span_before = function (this: SnippetProvider, original: Span, needle: string): BytePos | undefined {
  const snippet = this.span_to_snippet(original);
  if (snippet === undefined) return undefined;
  const offset = FindUncommented_str.find_uncommented(snippet, needle);
  if (offset === undefined) return undefined;

  return BytePos.add(Span.lo(original), BytePos(u32_wrapping(offset)));
};
