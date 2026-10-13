// Port of pulldown-cmark-0.11.3/src/scanners.rs.
// Copyright 2015 Google Inc. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

//! Scanners for fragments of CommonMark syntax
//!
//! PORT: `&[u8]` is a `Uint8Array` (`&data[i..]` is `data.subarray(i)`); `&str` of the markdown text
//! is a `Str`; `Vec<u8>` buffers are `number[]`; `Option<&dyn Fn(&[u8]) -> usize>` newline handlers
//! are `((bytes: Uint8Array) => number) | undefined`; `&mut usize` out-params are `MutRef<number>`.
//! `memchr::memchr(b, hay)` is the local `memchr` helper (`hay.indexOf(b)`, -1 mapped to `undefined`).

import { from_u32, is_ascii_alphabetic, is_ascii_digit, to_string as char_to_string } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import type { Result } from "../../std/result.ts";
import { Err, Ok, ok } from "../../std/result.ts";
import { binary_search_by } from "../../std/slice.ts";
import { Str } from "../../std/str.ts";
import { get_entity } from "./entities.ts";
import { type Alignment, type BlockQuoteKind, HeadingLevel, type LinkType } from "./lib.ts";
import type { HtmlScanGuard } from "./parse.ts";
import { is_ascii_punctuation } from "./puncttable.ts";
import type { CowStr } from "./strings.ts";

export { is_ascii_punctuation, is_punctuation } from "./puncttable.ts";

// PORT: memchr — `memchr::memchr(needle, haystack)`.
function memchr(needle: number, haystack: Uint8Array): number | undefined {
  const i = haystack.indexOf(needle);
  return i === -1 ? undefined : i;
}

// PORT: `Vec<u8>::extend(&[u8])` without spreading into call arguments.
function extend_bytes(buffer: number[], bytes: Uint8Array): void {
  for (const b of bytes) buffer.push(b);
}

// sorted for binary search
const HTML_TAGS: readonly string[] = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
];

/// Analysis of the beginning of a line, including indentation and container
/// markers.
export class LineStart {
  constructor(
    public bytes: Uint8Array,
    public ix: number,

    // The index in `bytes` after the last tab we scanned; initially
    // zero.
    //
    // Thus, there are no tab characters between `ix` and here, and for
    // the purpose of defining block structure, this position can be
    // considered to fall on a tab stop.
    //
    // This is only valid while scanning the initial portion of the
    // line; methods that work with interior structure don't bother to
    // update it.
    public tab_start: number,

    // In contexts where spaces help to define block structure, tabs
    // behave as if they were replaced by spaces with a tab stop of 4
    // characters.
    //
    // If we have scanned past a tab character but not consumed all
    // the horizontal width it contributed, this is the number of
    // spaces logically remaining, before the character at `ix`.
    public spaces_remaining: number,

    // no thematic breaks can occur before this offset.
    // this prevents scanning over and over up to a certain point
    public min_hrule_offset: number,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): LineStart {
    return new LineStart(this.bytes, this.ix, this.tab_start, this.spaces_remaining, this.min_hrule_offset);
  }

  /** `*self = other` */
  assign(other: LineStart): void {
    this.bytes = other.bytes;
    this.ix = other.ix;
    this.tab_start = other.tab_start;
    this.spaces_remaining = other.spaces_remaining;
    this.min_hrule_offset = other.min_hrule_offset;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:133 new
  static new(bytes: Uint8Array): LineStart {
    return new LineStart(bytes, 0, 0, 0, 0);
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:148 scan_space
  /// Try to scan a number of spaces.
  ///
  /// Returns true if all spaces were consumed.
  ///
  /// Note: consumes some spaces even if not successful.
  scan_space(n_space: number): boolean {
    return this.scan_space_inner(n_space) === 0;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:155 scan_space_upto
  /// Scan a number of spaces up to a maximum.
  ///
  /// Returns number of spaces scanned.
  scan_space_upto(n_space: number): number {
    return n_space - this.scan_space_inner(n_space);
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:160 scan_space_inner
  /// Returns unused remainder of spaces.
  private scan_space_inner(n_space: number): number {
    // Consume any common prefix between the number of spaces we
    // want and the number of unscanned tab-introduced spaces.
    const n_from_remaining = Math.min(this.spaces_remaining, n_space);
    this.spaces_remaining -= n_from_remaining;
    n_space -= n_from_remaining;

    while (n_space > 0 && this.ix < this.bytes.length) {
      const b = this.bytes[this.ix]!;
      if (b === 0x20 /* ' ' */) {
        this.ix += 1;
        n_space -= 1;
      } else if (b === 0x09 /* \t */) {
        const spaces = 4 - ((this.ix - this.tab_start) % 4);
        this.ix += 1;
        this.tab_start = this.ix;
        const n = Math.min(spaces, n_space);
        n_space -= n;

        // Record the unscanned portion of the tab.
        this.spaces_remaining = spaces - n;
      } else {
        break;
      }
    }
    return n_space;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:190 scan_all_space
  /// Scan all available ASCII whitespace (not including eol).
  scan_all_space(): void {
    this.spaces_remaining = 0;
    this.ix += scan_while(this.bytes.subarray(this.ix), (b) => b === 0x20 /* ' ' */ || b === 0x09 /* \t */);
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:199 is_at_eol
  /// Determine whether we're at end of line (includes end of file).
  is_at_eol(): boolean {
    const c = this.bytes[this.ix];
    return c === undefined ? true : c === 0x0d /* \r */ || c === 0x0a /* \n */;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:206 scan_ch
  private scan_ch(c: number): boolean {
    if (this.ix < this.bytes.length && this.bytes[this.ix] === c) {
      this.ix += 1;
      return true;
    } else {
      return false;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:215 scan_case_insensitive
  private scan_case_insensitive(tag: Uint8Array): boolean {
    if (this.bytes.length - this.ix < tag.length) {
      return false;
    }
    const prefix = this.bytes.subarray(this.ix, this.ix + tag.length);
    const ok_ = eq_ignore_ascii_case(prefix, tag);
    if (ok_) {
      this.ix += tag.length;
    }
    return ok_;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:227 scan_blockquote_tag
  scan_blockquote_tag(): BlockQuoteKind | undefined {
    const saved_ix = this.ix;
    let tag: BlockQuoteKind | undefined;
    if (this.scan_ch(0x5b /* [ */) && this.scan_ch(0x21 /* ! */)) {
      let tag_: BlockQuoteKind | undefined;
      if (this.scan_case_insensitive(B_NOTE)) {
        tag_ = "Note";
      } else if (this.scan_case_insensitive(B_TIP)) {
        tag_ = "Tip";
      } else if (this.scan_case_insensitive(B_IMPORTANT)) {
        tag_ = "Important";
      } else if (this.scan_case_insensitive(B_WARNING)) {
        tag_ = "Warning";
      } else if (this.scan_case_insensitive(B_CAUTION)) {
        tag_ = "Caution";
      } else {
        tag_ = undefined;
      }
      if (tag_ !== undefined && this.scan_ch(0x5d /* ] */)) {
        const nl = scan_blank_line(this.bytes.subarray(this.ix));
        if (nl !== undefined) {
          this.ix += nl;
          tag = tag_;
        } else {
          tag = undefined;
        }
      } else {
        tag = undefined;
      }
    } else {
      tag = undefined;
    }
    if (tag === undefined) {
      this.ix = saved_ix;
    }
    return tag;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:262 scan_blockquote_marker
  scan_blockquote_marker(): boolean {
    const save = this.clone();
    this.scan_space(3);
    if (this.scan_ch(0x3e /* > */)) {
      this.scan_space(1);
      return true;
    } else {
      this.assign(save);
      return false;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:279 scan_list_marker
  /// Scan a list marker.
  ///
  /// Return value is the character, the start index, and the indent in spaces.
  /// For ordered list markers, the character will be one of b'.' or b')'. For
  /// bullet list markers, it will be one of b'-', b'+', or b'*'.
  // PORT: the `u64` start is a `number` (at most 10 digits are read).
  scan_list_marker(): [number, number, number] | undefined {
    const save = this.clone();
    const indent = this.scan_space_upto(4);
    if (indent < 4 && this.ix < this.bytes.length) {
      const c = this.bytes[this.ix]!;
      if (c === 0x2d /* - */ || c === 0x2b /* + */ || c === 0x2a /* * */) {
        if (this.ix >= this.min_hrule_offset) {
          // there could be an hrule here
          const r = scan_hrule(this.bytes.subarray(this.ix));
          if (r.$ === "Err") {
            const min_offset = r._0;
            this.min_hrule_offset = min_offset;
          } else {
            this.assign(save);
            return undefined;
          }
        }
        this.ix += 1;
        if (this.scan_space(1) || this.is_at_eol()) {
          return this.finish_list_marker(c, 0, indent + 2);
        }
      } else if (is_ascii_digit(c)) {
        const start_ix = this.ix;
        let ix = this.ix + 1;
        let val = c - 0x30; /* '0' */
        while (ix < this.bytes.length && ix - start_ix < 10) {
          const c = this.bytes[ix]!;
          ix += 1;
          if (is_ascii_digit(c)) {
            val = val * 10 + (c - 0x30); /* '0' */
          } else if (c === 0x29 /* ) */ || c === 0x2e /* . */) {
            this.ix = ix;
            if (this.scan_space(1) || this.is_at_eol()) {
              return this.finish_list_marker(c, val, indent + 1 + ix - start_ix);
            } else {
              break;
            }
          } else {
            break;
          }
        }
      }
    }
    this.assign(save);
    return undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:324 finish_list_marker
  private finish_list_marker(c: number, start: number, indent: number): [number, number, number] | undefined {
    const save = this.clone();

    // skip the rest of the line if it's blank
    if (scan_blank_line(this.bytes.subarray(this.ix)) !== undefined) {
      return [c, start, indent];
    }

    const post_indent = this.scan_space_upto(4);
    if (post_indent < 4) {
      indent += post_indent;
    } else {
      this.assign(save);
    }
    return [c, start, indent];
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:348 scan_task_list_marker
  /// Returns Some(is_checked) when a task list marker was found. Resets itself
  /// to original state otherwise.
  scan_task_list_marker(): boolean | undefined {
    const save = this.clone();
    this.scan_space_upto(3);

    if (!this.scan_ch(0x5b /* [ */)) {
      this.assign(save);
      return undefined;
    }
    let is_checked: boolean;
    const c = this.bytes[this.ix];
    if (c !== undefined && is_ascii_whitespace_no_nl(c)) {
      this.ix += 1;
      is_checked = false;
    } else if (c === 0x78 /* x */ || c === 0x58 /* X */) {
      this.ix += 1;
      is_checked = true;
    } else {
      this.assign(save);
      return undefined;
    }
    if (!this.scan_ch(0x5d /* ] */)) {
      this.assign(save);
      return undefined;
    }
    const b = this.bytes[this.ix];
    if (!(b !== undefined ? is_ascii_whitespace_no_nl(b) : false)) {
      this.assign(save);
      return undefined;
    }
    return is_checked;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:386 bytes_scanned
  bytes_scanned(): number {
    return this.ix;
  }

  // crate: pulldown-cmark-0.11.3/src/scanners.rs:390 remaining_space
  remaining_space(): number {
    return this.spaces_remaining;
  }
}

// The byte-string literals of `scan_blockquote_tag`.
const B_NOTE = new Uint8Array([0x6e, 0x6f, 0x74, 0x65]); // b"note"
const B_TIP = new Uint8Array([0x74, 0x69, 0x70]); // b"tip"
const B_IMPORTANT = new Uint8Array([0x69, 0x6d, 0x70, 0x6f, 0x72, 0x74, 0x61, 0x6e, 0x74]); // b"important"
const B_WARNING = new Uint8Array([0x77, 0x61, 0x72, 0x6e, 0x69, 0x6e, 0x67]); // b"warning"
const B_CAUTION = new Uint8Array([0x63, 0x61, 0x75, 0x74, 0x69, 0x6f, 0x6e]); // b"caution"

/** `<[u8]>::eq_ignore_ascii_case` */
function eq_ignore_ascii_case(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (u8_to_ascii_lowercase(a[i]!) !== u8_to_ascii_lowercase(b[i]!)) return false;
  }
  return true;
}

/** `u8::to_ascii_lowercase` */
function u8_to_ascii_lowercase(c: number): number {
  return c >= 0x41 && c <= 0x5a ? c | 0x20 : c;
}

/** `u8::is_ascii_whitespace`: `\t`, `\n`, form feed, `\r`, space (not vertical tab). */
function u8_is_ascii_whitespace(c: number): boolean {
  return c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:395 is_ascii_whitespace
export function is_ascii_whitespace(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || c === 0x20; /* ' ' */
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:399 is_ascii_whitespace_no_nl
export function is_ascii_whitespace_no_nl(c: number): boolean {
  return c === 0x09 /* \t */ || c === 0x0b || c === 0x0c || c === 0x20; /* ' ' */
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:403 is_ascii_alpha
function is_ascii_alpha(c: number): boolean {
  return is_ascii_alphabetic(c);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:407 is_ascii_alphanumeric
function is_ascii_alphanumeric(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:411 is_ascii_letterdigitdash
function is_ascii_letterdigitdash(c: number): boolean {
  return c === 0x2d /* - */ || is_ascii_alphanumeric(c);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:415 is_digit
function is_digit(c: number): boolean {
  return is_ascii_digit(c);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:419 is_valid_unquoted_attr_value_char
function is_valid_unquoted_attr_value_char(c: number): boolean {
  return !(
    c === 0x27 /* ' */ ||
    c === 0x22 /* " */ ||
    c === 0x20 /* ' ' */ ||
    c === 0x3d /* = */ ||
    c === 0x3e /* > */ ||
    c === 0x3c /* < */ ||
    c === 0x60 /* ` */ ||
    c === 0x0a /* \n */ ||
    c === 0x0d /* \r */
  );
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:427 scan_ch
// scan a single character
export function scan_ch(data: Uint8Array, c: number): number {
  if (data.length !== 0 && data[0] === c) {
    return 1;
  } else {
    return 0;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:435 scan_while
export function scan_while(data: Uint8Array, f: (c: number) => boolean): number {
  let n = 0;
  while (n < data.length && f(data[n]!)) n++;
  return n;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:442 scan_rev_while
export function scan_rev_while(data: Uint8Array, f: (c: number) => boolean): number {
  let n = 0;
  while (n < data.length && f(data[data.length - 1 - n]!)) n++;
  return n;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:449 scan_ch_repeat
export function scan_ch_repeat(data: Uint8Array, c: number): number {
  return scan_while(data, (x) => x === c);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:455 scan_whitespace_no_nl
// Note: this scans ASCII whitespace only, for Unicode whitespace use
// a different function.
export function scan_whitespace_no_nl(data: Uint8Array): number {
  return scan_while(data, is_ascii_whitespace_no_nl);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:459 scan_attr_value_chars
function scan_attr_value_chars(data: Uint8Array): number {
  return scan_while(data, is_valid_unquoted_attr_value_char);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:463 scan_eol
export function scan_eol(bytes: Uint8Array): number | undefined {
  if (bytes.length === 0) {
    return 0;
  }
  switch (bytes[0]) {
    case 0x0a /* \n */:
      return 1;
    case 0x0d /* \r */:
      return bytes[1] === 0x0a /* \n */ ? 2 : 1;
    default:
      return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:474 scan_blank_line
export function scan_blank_line(bytes: Uint8Array): number | undefined {
  const i = scan_whitespace_no_nl(bytes);
  const n = scan_eol(bytes.subarray(i));
  return n === undefined ? undefined : i + n;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:479 scan_nextline
export function scan_nextline(bytes: Uint8Array): number {
  const x = memchr(0x0a /* \n */, bytes);
  return x === undefined ? bytes.length : x + 1;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:485 scan_closing_code_fence
// return: end byte for closing code fence, or None
// if the line is not a closing code fence
export function scan_closing_code_fence(bytes: Uint8Array, fence_char: number, n_fence_char: number): number | undefined {
  if (bytes.length === 0) {
    return 0;
  }
  let i = 0;
  const num_fence_chars_found = scan_ch_repeat(bytes.subarray(i), fence_char);
  if (num_fence_chars_found < n_fence_char) {
    return undefined;
  }
  i += num_fence_chars_found;
  const num_trailing_spaces = scan_ch_repeat(bytes.subarray(i), 0x20 /* ' ' */);
  i += num_trailing_spaces;
  return scan_eol(bytes.subarray(i)) === undefined ? undefined : i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:506 scan_closing_metadata_block
// return: end byte for closing metadata block, or None
// if the line is not a closing metadata block
export function scan_closing_metadata_block(bytes: Uint8Array, fence_char: number): number | undefined {
  let i = 0;
  let num_fence_chars_found = scan_ch_repeat(bytes.subarray(i), fence_char);
  if (num_fence_chars_found !== 3) {
    // if YAML style metadata block the closing character can also be `.`
    if (fence_char === 0x2d /* - */) {
      num_fence_chars_found = scan_ch_repeat(bytes.subarray(i), 0x2e /* . */);
      if (num_fence_chars_found !== 3) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  i += num_fence_chars_found;
  const num_trailing_spaces = scan_ch_repeat(bytes.subarray(i), 0x20 /* ' ' */);
  i += num_trailing_spaces;
  return scan_eol(bytes.subarray(i)) === undefined ? undefined : i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:527 calc_indent
// returned pair is (number of bytes, number of spaces)
export function calc_indent(text: Uint8Array, max: number): [number, number] {
  let spaces = 0;
  let offset = 0;

  for (let i = 0; i < text.length; i++) {
    const b = text[i]!;
    offset = i;
    if (b === 0x20 /* ' ' */) {
      spaces += 1;
      if (spaces === max) {
        break;
      }
    } else if (b === 0x09 /* \t */) {
      const new_spaces = spaces + 4 - (spaces & 3);
      if (new_spaces > max) {
        break;
      }
      spaces = new_spaces;
    } else {
      break;
    }
  }

  return [offset, spaces];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:561 scan_hrule
/// Scan hrule opening sequence.
///
/// Returns Ok(x) when it finds an hrule, where x is the
/// size of line containing the hrule, including the trailing newline.
///
/// Returns Err(x) when it does not find an hrule and x is
/// the offset in data before no hrule can appear.
export function scan_hrule(bytes: Uint8Array): Result<number, number> {
  if (bytes.length < 3) {
    return Err(0);
  }
  const c = bytes[0]!;
  if (!(c === 0x2a /* * */ || c === 0x2d /* - */ || c === 0x5f) /* _ */) {
    return Err(0);
  }
  let n = 0;
  let i = 0;

  while (i < bytes.length) {
    const c2 = bytes[i]!;
    if (c2 === 0x0a /* \n */ || c2 === 0x0d /* \r */) {
      i += scan_eol(bytes.subarray(i)) ?? 0;
      break;
    } else if (c2 === c) {
      n += 1;
    } else if (c2 === 0x20 /* ' ' */ || c2 === 0x09 /* \t */) {
      // ()
    } else {
      return Err(i);
    }
    i += 1;
  }
  if (n >= 3) {
    return Ok(i);
  } else {
    return Err(i);
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:596 scan_atx_heading
/// Scan an ATX heading opening sequence.
///
/// Returns number of bytes in prefix and level.
export function scan_atx_heading(data: Uint8Array): HeadingLevel | undefined {
  const level = scan_ch_repeat(data, 0x23 /* # */);
  const next = data[level];
  if (next === undefined ? true : is_ascii_whitespace(next)) {
    return ok(HeadingLevel.try_from(level));
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:608 scan_setext_heading
/// Scan a setext heading underline.
///
/// Returns number of bytes in line (including trailing newline) and level.
export function scan_setext_heading(data: Uint8Array): [number, HeadingLevel] | undefined {
  const c = data[0];
  if (c === undefined) return undefined;
  let level: HeadingLevel;
  if (c === 0x3d /* = */) {
    level = "H1";
  } else if (c === 0x2d /* - */) {
    level = "H2";
  } else {
    return undefined;
  }
  let i = 1 + scan_ch_repeat(data.subarray(1), c);
  const n = scan_blank_line(data.subarray(i));
  if (n === undefined) return undefined;
  i += n;
  return [i, level];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:624 scan_table_head
// returns number of bytes in line (including trailing
// newline) and column alignments
export function scan_table_head(data: Uint8Array): [number, Alignment[]] {
  let [i, spaces] = calc_indent(data, 4);
  if (spaces > 3 || i === data.length) {
    return [0, []];
  }
  const cols: Alignment[] = [];
  let active_col: Alignment = "None";
  let start_col = true;
  let found_pipe = false;
  let found_hyphen = false;
  let found_hyphen_in_col = false;
  if (data[i] === 0x7c /* | */) {
    i += 1;
    found_pipe = true;
  }
  for (const c of data.subarray(i)) {
    const n = scan_eol(data.subarray(i));
    if (n !== undefined) {
      i += n;
      break;
    }
    if (c === 0x20 /* ' ' */) {
      // ()
    } else if (c === 0x3a /* : */) {
      if (start_col && active_col === "None") {
        active_col = "Left";
      } else if (!start_col && active_col === "Left") {
        active_col = "Center";
      } else if (!start_col && active_col === "None") {
        active_col = "Right";
      } else {
        // active_col
      }
      start_col = false;
    } else if (c === 0x2d /* - */) {
      start_col = false;
      found_hyphen = true;
      found_hyphen_in_col = true;
    } else if (c === 0x7c /* | */) {
      start_col = true;
      found_pipe = true;
      cols.push(active_col);
      active_col = "None";
      if (!found_hyphen_in_col) {
        // It isn't a table head if it has back-to-back pipes.
        return [0, []];
      }
      found_hyphen_in_col = false;
    } else {
      // It isn't a table head if it has characters outside the allowed set.
      return [0, []];
    }
    i += 1;
  }

  if (!start_col) {
    cols.push(active_col);
  }
  if (!found_pipe || !found_hyphen) {
    // It isn't a table head if it doesn't have a least one pipe or hyphen.
    // It's a list, a header, or a thematic break.
    return [0, []];
  }

  return [i, cols];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:694 scan_code_fence
/// Scan code fence.
///
/// Returns number of bytes scanned and the char that is repeated to make the code fence.
export function scan_code_fence(data: Uint8Array): [number, number] | undefined {
  const c = data[0];
  if (c === undefined) return undefined;
  if (!(c === 0x60 /* ` */ || c === 0x7e) /* ~ */) {
    return undefined;
  }
  const i = 1 + scan_ch_repeat(data.subarray(1), c);
  if (i >= 3) {
    if (c === 0x60 /* ` */) {
      const suffix = data.subarray(i);
      const next_line = i + scan_nextline(suffix);
      // FIXME: make sure this is correct
      if (suffix.subarray(0, next_line - i).includes(0x60 /* ` */)) {
        return undefined;
      }
    }
    return [i, c];
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:723 scan_metadata_block
/// Scan metadata block, returning the number of delimiter bytes
/// (always 3 for now) and the delimiter character.
///
/// Differently to code blocks, metadata blocks must be closed with the closing
/// sequence not being a valid terminator the end of the file.
///
/// In addition, they cannot be empty (closing sequence in the next line) and
/// the next line cannot be an empty line.
export function scan_metadata_block(data: Uint8Array, yaml_style_enabled: boolean, pluses_style_enabled: boolean): [number, number] | undefined {
  // Only if metadata blocks are enabled
  if (yaml_style_enabled || pluses_style_enabled) {
    const c = data[0];
    if (c === undefined) return undefined;
    if (!((c === 0x2d /* - */ && yaml_style_enabled) || (c === 0x2b /* + */ && pluses_style_enabled))) {
      return undefined;
    }
    const i = 1 + scan_ch_repeat(data.subarray(1), c);
    // Only trailing spaces after the delimiters in the line
    const next_line = scan_nextline(data.subarray(i));
    for (const c of data.subarray(i, i + next_line)) {
      if (!u8_is_ascii_whitespace(c)) {
        return undefined;
      }
    }
    if (i === 3) {
      // Search the closing sequence
      let j = i;
      let first_line = true;
      while (j < data.length) {
        j += scan_nextline(data.subarray(j));
        const closed = scan_closing_metadata_block(data.subarray(j), c) !== undefined;
        // The first line of the metadata block cannot be an empty line
        // nor the end of the block
        if (first_line) {
          if (closed || scan_blank_line(data.subarray(j)) !== undefined) {
            return undefined;
          }
          first_line = false;
        }
        if (closed) {
          return [i, c];
        }
      }
      return undefined;
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:770 scan_blockquote_start
export function scan_blockquote_start(data: Uint8Array): number | undefined {
  if (data[0] === 0x3e /* > */) {
    const space = data[1] === 0x20 /* ' ' */ ? 1 : 0;
    return 1 + space;
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:784 scan_listitem
/// return number of bytes scanned, delimiter, start index, and indent
export function scan_listitem(bytes: Uint8Array): [number, number, number, number] | undefined {
  let c = bytes[0];
  if (c === undefined) return undefined;
  let w: number;
  let start: number;
  if (c === 0x2d /* - */ || c === 0x2b /* + */ || c === 0x2a /* * */) {
    [w, start] = [1, 0];
  } else if (c >= 0x30 /* 0 */ && c <= 0x39 /* 9 */) {
    const [length, start_] = parse_decimal(bytes, 9);
    c = bytes[length];
    if (c === undefined) return undefined;
    if (!(c === 0x2e /* . */ || c === 0x29) /* ) */) {
      return undefined;
    }
    [w, start] = [length + 1, start_];
  } else {
    return undefined;
  }
  // TODO: replace calc_indent with scan_leading_whitespace, for tab correctness
  let [postn, postindent] = calc_indent(bytes.subarray(w), 5);
  if (postindent === 0) {
    if (scan_eol(bytes.subarray(w)) === undefined) return undefined;
    postindent += 1;
  } else if (postindent > 4) {
    postn = 1;
    postindent = 1;
  }
  if (scan_blank_line(bytes.subarray(w)) !== undefined) {
    postn = 0;
    postindent = 1;
  }
  return [w + postn, c, start, w + postindent];
}

// PORT: `usize::checked_mul(m).and_then(|x| x.checked_add(digit))` on a JS number. The callers' digit
// limits (decimal: 7 or 9 digits, hex: 6 digits) keep `acc` far below 2^53, so the result is exact and
// the overflow (`None`) branch is never taken; the comparison against `usize::MAX` mirrors upstream.
const USIZE_MAX = 18446744073709551615;
function checked_mul_add(acc: number, m: number, digit: number): number | undefined {
  const number = acc * m + digit;
  return number > USIZE_MAX ? undefined : number;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:817 parse_decimal
// returns (number of bytes, parsed decimal)
function parse_decimal(bytes: Uint8Array, limit: number): [number, number] {
  // `bytes.iter().take(limit).take_while(is_digit).try_fold((0, 0usize), ..)`; `Ok(p) | Err(p) => p`.
  let count = 0;
  let acc = 0;
  const n = Math.min(limit, bytes.length);
  for (let k = 0; k < n; k++) {
    const c = bytes[k]!;
    if (!is_digit(c)) break;
    const digit = c - 0x30; /* '0' */
    const number = checked_mul_add(acc, 10, digit);
    if (number !== undefined) {
      [count, acc] = [count + 1, number];
    } else {
      // stop early on overflow
      return [count, acc];
    }
  }
  return [count, acc];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:838 parse_hex
// returns (number of bytes, parsed hex)
function parse_hex(bytes: Uint8Array, limit: number): [number, number] {
  // `bytes.iter().take(limit).try_fold((0, 0usize), ..)`; `Ok(p) | Err(p) => p`.
  let count = 0;
  let acc = 0;
  const n = Math.min(limit, bytes.length);
  for (let k = 0; k < n; k++) {
    let c = bytes[k]!;
    let digit: number;
    if (is_ascii_digit(c)) {
      digit = c - 0x30; /* '0' */
    } else {
      // make lower case
      c |= 0x20;
      if (c >= 0x61 /* a */ && c <= 0x66 /* f */) {
        digit = c - 0x61 /* a */ + 10;
      } else {
        return [count, acc];
      }
    }
    const number = checked_mul_add(acc, 16, digit);
    if (number !== undefined) {
      [count, acc] = [count + 1, number];
    } else {
      // stop early on overflow
      return [count, acc];
    }
  }
  return [count, acc];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:868 char_from_codepoint
function char_from_codepoint(input: number): number | undefined {
  // `input.try_into().ok()?` (usize -> u32)
  if (input > 0xffffffff) return undefined;
  const codepoint = input;
  if (codepoint === 0) {
    return undefined;
  }
  return from_u32(codepoint);
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:877 scan_entity
// doesn't bother to check data[0] == '&'
export function scan_entity(bytes: Uint8Array): [number, CowStr | undefined] {
  let end = 1;
  if (scan_ch(bytes.subarray(end), 0x23 /* # */) === 1) {
    end += 1;
    let bytecount: number;
    let codepoint: number;
    if (end < bytes.length && (bytes[end]! | 0x20) === 0x78 /* x */) {
      end += 1;
      [bytecount, codepoint] = parse_hex(bytes.subarray(end), 6);
    } else {
      [bytecount, codepoint] = parse_decimal(bytes.subarray(end), 7);
    }
    end += bytecount;
    return bytecount === 0 || scan_ch(bytes.subarray(end), 0x3b /* ; */) === 0
      ? [0, undefined]
      : [end + 1, char_to_string(char_from_codepoint(codepoint) ?? 0xfffd)];
  }
  end += scan_while(bytes.subarray(end), is_ascii_alphanumeric);
  if (scan_ch(bytes.subarray(end), 0x3b /* ; */) === 1) {
    const value = get_entity(bytes.subarray(1, end));
    if (value !== undefined) {
      return [end + 1, value];
    }
  }
  return [0, undefined];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:909 scan_link_dest
// note: dest returned is raw, still needs to be unescaped
// TODO: check that nested parens are really not allowed for refdefs
// TODO(performance): this func should probably its own unescaping
// PORT: `data: &str` is the markdown text (callers pass `self.text` / `underlying`), so a `Str`; the
// returned `&str` is a slice of it, also a `Str`.
export function scan_link_dest(data: Str, start_ix: number, max_next: number): [number, Str] | undefined {
  const bytes = data.b.subarray(data.lo + start_ix, data.hi);
  let i = scan_ch(bytes, 0x3c /* < */);

  if (i !== 0) {
    // pointy links
    while (i < bytes.length) {
      const b = bytes[i]!;
      if (b === 0x0a /* \n */ || b === 0x0d /* \r */ || b === 0x3c /* < */) {
        return undefined;
      } else if (b === 0x3e /* > */) {
        return [i + 1, data.slice(start_ix + 1, start_ix + i)];
      } else if (b === 0x5c /* \ */ && i + 1 < bytes.length && is_ascii_punctuation(bytes[i + 1]!)) {
        i += 1;
      }
      i += 1;
    }
    return undefined;
  } else {
    // non-pointy links
    let nest = 0;
    while (i < bytes.length) {
      const b = bytes[i]!;
      if (b <= 0x20) {
        break;
      } else if (b === 0x28 /* ( */) {
        if (nest > max_next) {
          return undefined;
        }
        nest += 1;
      } else if (b === 0x29 /* ) */) {
        if (nest === 0) {
          break;
        }
        nest -= 1;
      } else if (b === 0x5c /* \ */ && i + 1 < bytes.length && is_ascii_punctuation(bytes[i + 1]!)) {
        i += 1;
      }
      i += 1;
    }
    if (nest !== 0) {
      return undefined;
    }
    return [i, data.slice(start_ix, start_ix + i)];
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:966 scan_attribute_name
/// Returns bytes scanned
function scan_attribute_name(data: Uint8Array): number | undefined {
  const c = data[0];
  if (c === undefined) return undefined;
  const tail = data.subarray(1);
  if (is_ascii_alpha(c) || c === 0x5f /* _ */ || c === 0x3a /* : */) {
    return (
      1 +
      scan_while(
        tail,
        (c) => is_ascii_alphanumeric(c) || c === 0x5f /* _ */ || c === 0x2e /* . */ || c === 0x3a /* : */ || c === 0x2d /* - */,
      )
    );
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:982 scan_attribute
/// Returns the index immediately following the attribute on success.
/// The argument `buffer_ix` refers to the index into `data` from which we
/// should copy into `buffer` when we find bytes to skip.
function scan_attribute(
  data: Uint8Array,
  ix: number,
  newline_handler: ((bytes: Uint8Array) => number) | undefined,
  buffer: number[],
  buffer_ix: MutRef<number>,
): number | undefined {
  const name = scan_attribute_name(data.subarray(ix));
  if (name === undefined) return undefined;
  ix += name;
  const ix_after_attribute = ix;
  const r0 = scan_whitespace_with_newline_handler_without_buffer(data, ix, newline_handler);
  if (r0 === undefined) return undefined;
  ix = r0;
  if (scan_ch(data.subarray(ix), 0x3d /* = */) === 1) {
    const r1 = scan_whitespace_with_newline_handler(data, ix_after_attribute, newline_handler, buffer, buffer_ix);
    if (r1 === undefined) return undefined;
    ix = r1;
    ix += 1;
    const r2 = scan_whitespace_with_newline_handler(data, ix, newline_handler, buffer, buffer_ix);
    if (r2 === undefined) return undefined;
    ix = r2;
    const r3 = scan_attribute_value(data, ix, newline_handler, buffer, buffer_ix);
    if (r3 === undefined) return undefined;
    ix = r3;
    return ix;
  } else {
    // Leave whitespace for next attribute.
    return ix_after_attribute;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1007 scan_whitespace_with_newline_handler
/// Scans whitespace and possibly newlines according to the
/// behavior defined by the newline handler. When bytes are skipped,
/// all preceding non-skipped bytes are pushed to the buffer.
function scan_whitespace_with_newline_handler(
  data: Uint8Array,
  i: number,
  newline_handler: ((bytes: Uint8Array) => number) | undefined,
  buffer: number[],
  buffer_ix: MutRef<number>,
): number | undefined {
  while (i < data.length) {
    if (!is_ascii_whitespace(data[i]!)) {
      return i;
    }
    const eol_bytes = scan_eol(data.subarray(i));
    if (eol_bytes !== undefined) {
      const handler = newline_handler;
      if (handler === undefined) return undefined;
      i += eol_bytes;
      const skipped_bytes = handler(data.subarray(i));

      if (skipped_bytes > 0) {
        extend_bytes(buffer, data.subarray(buffer_ix.value, i));
        buffer_ix.value = i + skipped_bytes;
      }

      i += skipped_bytes;
    } else {
      i += 1;
    }
  }

  return i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1044 scan_whitespace_with_newline_handler_without_buffer
/// Scans whitespace and possible newlines according to the behavior defined
/// by the newline handler.
///
/// Unlike [`scan_whitespace_with_newline_handler`], this function doesn't
/// copy skipped data into a buffer. Typically, if this function
/// returns `Some`, a call to `scan_whitespace_with_newline_handler` will
/// soon follow.
function scan_whitespace_with_newline_handler_without_buffer(
  data: Uint8Array,
  i: number,
  newline_handler: ((bytes: Uint8Array) => number) | undefined,
): number | undefined {
  while (i < data.length) {
    if (!is_ascii_whitespace(data[i]!)) {
      return i;
    }
    const eol_bytes = scan_eol(data.subarray(i));
    if (eol_bytes !== undefined) {
      const handler = newline_handler;
      if (handler === undefined) return undefined;
      i += eol_bytes;
      const skipped_bytes = handler(data.subarray(i));
      i += skipped_bytes;
    } else {
      i += 1;
    }
  }

  return i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1067 scan_attribute_value
/// Returns the index immediately following the attribute value on success.
function scan_attribute_value(
  data: Uint8Array,
  i: number,
  newline_handler: ((bytes: Uint8Array) => number) | undefined,
  buffer: number[],
  buffer_ix: MutRef<number>,
): number | undefined {
  const b = data[i];
  if (b === undefined) return undefined;
  if (b === 0x22 /* " */ || b === 0x27 /* ' */) {
    i += 1;
    while (i < data.length) {
      if (data[i] === b) {
        return i + 1;
      }
      const eol_bytes = scan_eol(data.subarray(i));
      if (eol_bytes !== undefined) {
        const handler = newline_handler;
        if (handler === undefined) return undefined;
        i += eol_bytes;
        const skipped_bytes = handler(data.subarray(i));

        if (skipped_bytes > 0) {
          extend_bytes(buffer, data.subarray(buffer_ix.value, i));
          buffer_ix.value = i + skipped_bytes;
        }
        i += skipped_bytes;
      } else {
        i += 1;
      }
    }
    return undefined;
  } else if (
    b === 0x20 /* ' ' */ ||
    b === 0x3d /* = */ ||
    b === 0x3e /* > */ ||
    b === 0x3c /* < */ ||
    b === 0x60 /* ` */ ||
    b === 0x0a /* \n */ ||
    b === 0x0d /* \r */
  ) {
    return undefined;
  } else {
    // unquoted attribute value
    i += scan_attr_value_chars(data.subarray(i));
  }

  return i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1110 unescape
// Remove backslash escapes and resolve entities
// PORT: `I: Into<CowStr<'a>>`: callers pass either a slice of the markdown text (`&self.text[..]`, the
// `&str` from `scan_link_dest`) or an owned `CowStr` (link titles), so `input` is `Str | string`; the
// result is a `CowStr` (`string`). Byte offsets index the UTF-8 bytes as upstream.
export function unescape(input_: Str | string, is_in_table: boolean): CowStr {
  const input = typeof input_ === "string" ? Str.from(input_) : input_;
  let result = "";
  let mark = 0;
  let i = 0;
  const bytes = input.b.subarray(input.lo, input.hi);
  while (i < bytes.length) {
    const b = bytes[i]!;
    // Tables are special, because they're parsed as-if the tables
    // were parsed in a discrete pass, changing `\|` to `|`, and then
    // passing the changed string to the inline parser.
    if (b === 0x5c /* \ */ && is_in_table && i + 2 < bytes.length && bytes[i + 1] === 0x5c /* \ */ && bytes[i + 2] === 0x7c /* | */) {
      // even number of `\`s before pipe
      // odd number is handled in the normal way below
      result += input.slice(mark, i).toString();
      mark = i + 2;
      i += 3;
    } else if (b === 0x5c /* \ */ && i + 1 < bytes.length && is_ascii_punctuation(bytes[i + 1]!)) {
      result += input.slice(mark, i).toString();
      mark = i + 1;
      i += 2;
    } else if (b === 0x26 /* & */) {
      const [n, value] = scan_entity(bytes.subarray(i));
      if (value !== undefined) {
        result += input.slice(mark, i).toString();
        result += value;
        i += n;
        mark = i;
      } else {
        i += 1;
      }
    } else if (b === 0x0d /* \r */) {
      result += input.slice(mark, i).toString();
      i += 1;
      mark = i;
    } else {
      i += 1;
    }
  }
  if (mark === 0) {
    return typeof input_ === "string" ? input_ : input.toString();
  } else {
    result += input.slice(mark).toString();
    return result;
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1164 starts_html_block_type_6
/// Assumes `data` is preceded by `<`.
export function starts_html_block_type_6(data: Uint8Array): boolean {
  const i = scan_ch(data, 0x2f /* / */);
  let tail = data.subarray(i);
  const n = scan_while(tail, is_ascii_alphanumeric);
  if (!is_html_tag(tail.subarray(0, n))) {
    return false;
  }
  // Starting condition says the next byte must be either a space, a tab,
  // the end of the line, the string >, or the string />
  tail = tail.subarray(n);
  return (
    tail.length === 0 ||
    tail[0] === 0x20 /* ' ' */ ||
    tail[0] === 0x09 /* \t */ ||
    tail[0] === 0x0d /* \r */ ||
    tail[0] === 0x0a /* \n */ ||
    tail[0] === 0x3e /* > */ ||
    (tail.length >= 2 && tail[0] === 0x2f /* / */ && tail[1] === 0x3e) /* > */
  );
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1183 is_html_tag
function is_html_tag(tag: Uint8Array): boolean {
  return binary_search_by(HTML_TAGS, (probe) => {
    // `probe_bytes_iter.zip(tag_bytes_iter).find_map(..).unwrap_or_else(|| probe.len().cmp(&tag.len()))`
    const n = Math.min(probe.length, tag.length);
    for (let k = 0; k < n; k++) {
      const a = probe.charCodeAt(k);
      const b = tag[k]!;
      // We can compare case insensitively because the probes are
      // all lower case alpha strings.
      const bl = b | 0x20;
      if (a !== bl) {
        return a < bl ? -1 : 1;
      }
    }
    return probe.length < tag.length ? -1 : probe.length > tag.length ? 1 : 0;
  }).ok;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1206 scan_html_type_7
/// Assumes that `data` starts with `<`.
/// Returns the index into data directly after the html tag on success.
export function scan_html_type_7(data: Uint8Array): number | undefined {
  // Block type html does not allow for newlines, so we
  // do not pass a newline handler.
  const r = scan_html_block_inner(data, undefined);
  if (r === undefined) return undefined;
  const [_span, i] = r;
  if (scan_blank_line(data.subarray(i)) === undefined) return undefined;
  return i;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1221 scan_html_block_inner
/// Assumes that `data` starts with `<`.
/// Returns the number of bytes scanned and the html in case of
/// success.
/// When some bytes were skipped, because the html was split over
/// multiple leafs (e.g. over multiple lines in a blockquote),
/// the html is returned as a vector of bytes.
/// If no bytes were skipped, the buffer will be empty.
// PORT: the `Vec<u8>` buffer is a `number[]` (callers convert with `new Uint8Array(span)`).
export function scan_html_block_inner(data: Uint8Array, newline_handler: ((bytes: Uint8Array) => number) | undefined): [number[], number] | undefined {
  const buffer: number[] = [];
  const last_buf_index: MutRef<number> = { value: 0 };

  const close_tag_bytes = scan_ch(data.subarray(1), 0x2f /* / */);
  const l = scan_while(data.subarray(1 + close_tag_bytes), is_ascii_alpha);
  if (l === 0) {
    return undefined;
  }
  let i = 1 + close_tag_bytes + l;
  i += scan_while(data.subarray(i), is_ascii_letterdigitdash);

  if (close_tag_bytes === 0) {
    for (;;) {
      const old_i = i;
      for (;;) {
        i += scan_whitespace_no_nl(data.subarray(i));
        const eol_bytes = scan_eol(data.subarray(i));
        if (eol_bytes !== undefined) {
          if (eol_bytes === 0) {
            return undefined;
          }
          const handler = newline_handler;
          if (handler === undefined) return undefined;
          i += eol_bytes;
          const skipped_bytes = handler(data.subarray(i));

          // let data_len = data.len() - i;  (only read by the debug_assert below)

          // debug_assert!(
          //     skipped_bytes <= data_len,
          //     "Handler tried to skip too many bytes, fed {}, skipped {}",
          //     data_len,
          //     skipped_bytes
          // );

          if (skipped_bytes > 0) {
            extend_bytes(buffer, data.subarray(last_buf_index.value, i));
            i += skipped_bytes;
            last_buf_index.value = i;
          }
        } else {
          break;
        }
      }
      const b = data[i];
      if (b === 0x2f /* / */ || b === 0x3e /* > */) {
        break;
      }
      if (old_i === i) {
        // No whitespace, which is mandatory.
        return undefined;
      }
      const r = scan_attribute(data, i, newline_handler, buffer, last_buf_index);
      if (r === undefined) return undefined;
      i = r;
    }
  }

  i += scan_whitespace_no_nl(data.subarray(i));

  if (close_tag_bytes === 0) {
    i += scan_ch(data.subarray(i), 0x2f /* / */);
  }

  if (scan_ch(data.subarray(i), 0x3e /* > */) === 0) {
    return undefined;
  } else {
    i += 1;
    if (buffer.length !== 0) {
      extend_bytes(buffer, data.subarray(last_buf_index.value, i));
    }
    return [buffer, i];
  }
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1296 scan_autolink
/// Returns (next_byte_offset, uri, type)
// PORT: `text: &str` is the block text of the markdown (a `Str`); the returned `CowStr` is a `string`.
export function scan_autolink(text: Str, start_ix: number): [number, CowStr, LinkType] | undefined {
  const uri = scan_uri(text, start_ix);
  if (uri !== undefined) {
    const [bytes, uri_] = uri;
    return [bytes, uri_, "Autolink"];
  }
  const email = scan_email(text, start_ix);
  if (email !== undefined) {
    const [bytes, uri_] = email;
    return [bytes, uri_, "Email"];
  }
  return undefined;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1303 scan_uri
/// Returns (next_byte_offset, uri)
function scan_uri(text: Str, start_ix: number): [number, CowStr] | undefined {
  const bytes = text.b.subarray(text.lo + start_ix, text.hi);

  // scheme's first byte must be an ascii letter
  if (bytes.length === 0 || !is_ascii_alpha(bytes[0]!)) {
    return undefined;
  }

  let i = 1;

  while (i < bytes.length) {
    const c = bytes[i]!;
    i += 1;
    if (is_ascii_alphanumeric(c)) {
      // ()
    } else if (c === 0x2e /* . */ || c === 0x2d /* - */ || c === 0x2b /* + */) {
      // ()
    } else if (c === 0x3a /* : */) {
      break;
    } else {
      return undefined;
    }
  }

  // scheme length must be between 2 and 32 characters long. scheme
  // must be followed by colon
  if (!(i >= 3 && i <= 33)) {
    return undefined;
  }

  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x3e /* > */) {
      return [start_ix + i + 1, text.slice(start_ix, start_ix + i).toString()];
    } else if (b <= 0x20 /* ' ' */ || b === 0x3c /* < */) {
      return undefined;
    }
    i += 1;
  }

  return undefined;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1343 scan_email
/// Returns (next_byte_offset, email)
// PORT: exported (private upstream) for the ported `mod test` in scanners.test.ts.
export function scan_email(text: Str, start_ix: number): [number, CowStr] | undefined {
  // using a regex library would be convenient, but doing it by hand is not too bad
  const bytes = text.b.subarray(text.lo + start_ix, text.hi);
  let i = 0;

  while (i < bytes.length) {
    const c = bytes[i]!;
    i += 1;
    if (is_ascii_alphanumeric(c)) {
      // ()
    } else if (
      c === 0x2e /* . */ ||
      c === 0x21 /* ! */ ||
      c === 0x23 /* # */ ||
      c === 0x24 /* $ */ ||
      c === 0x25 /* % */ ||
      c === 0x26 /* & */ ||
      c === 0x27 /* ' */ ||
      c === 0x2a /* * */ ||
      c === 0x2b /* + */ ||
      c === 0x2f /* / */ ||
      c === 0x3d /* = */ ||
      c === 0x3f /* ? */ ||
      c === 0x5e /* ^ */ ||
      c === 0x5f /* _ */ ||
      c === 0x60 /* ` */ ||
      c === 0x7b /* { */ ||
      c === 0x7c /* | */ ||
      c === 0x7d /* } */ ||
      c === 0x7e /* ~ */ ||
      c === 0x2d /* - */
    ) {
      // ()
    } else if (c === 0x40 /* @ */ && i > 1) {
      break;
    } else {
      return undefined;
    }
  }

  for (;;) {
    const label_start_ix = i;
    let fresh_label = true;

    while (i < bytes.length) {
      const c = bytes[i]!;
      if (is_ascii_alphanumeric(c)) {
        // ()
      } else if (c === 0x2d /* - */ && fresh_label) {
        return undefined;
      } else if (c === 0x2d /* - */) {
        // ()
      } else {
        break;
      }
      fresh_label = false;
      i += 1;
    }

    if (i === label_start_ix || i - label_start_ix > 63 || bytes[i - 1] === 0x2d /* - */) {
      return undefined;
    }

    if (scan_ch(bytes.subarray(i), 0x2e /* . */) === 0) {
      break;
    }
    i += 1;
  }

  if (scan_ch(bytes.subarray(i), 0x3e /* > */) === 0) {
    return undefined;
  }

  return [start_ix + i + 1, text.slice(start_ix, start_ix + i).toString()];
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1396 scan_inline_html_comment
/// Scan comment, declaration, or CDATA section, with initial "<!" already consumed.
/// Returns byte offset on match.
export function scan_inline_html_comment(bytes: Uint8Array, ix: number, scan_guard: HtmlScanGuard): number | undefined {
  const c = bytes[ix];
  if (c === undefined) return undefined;
  ix += 1;
  // An HTML comment consists of `<!-->`, `<!--->`, or  `<!--`, a string of characters not
  // including the string `-->`, and `-->`.
  if (c === 0x2d /* - */ && ix > scan_guard.comment) {
    // HTML comment needs two hyphens after the !.
    const c2 = bytes[ix];
    if (c2 === undefined) return undefined;
    if (c2 !== 0x2d /* - */) {
      return undefined;
    }
    // Yes, we're intentionally going backwards.
    // We want the cursor to point here:
    //
    //     <!--
    //       ^
    //
    // This way, the `<!-->` case is covered by the loop below.
    ix -= 1;

    for (let x = memchr(0x2d /* - */, bytes.subarray(ix)); x !== undefined; x = memchr(0x2d /* - */, bytes.subarray(ix))) {
      ix += x + 1;
      scan_guard.comment = ix;
      if (scan_ch(bytes.subarray(ix), 0x2d /* - */) === 1 && scan_ch(bytes.subarray(ix + 1), 0x3e /* > */) === 1) {
        return ix + 2;
      }
    }
    return undefined;
  }
  // A CDATA section consists of the string `<![CDATA[`, a string of characters not
  // including the string `]]>`, and the string `]]>`.
  else if (c === 0x5b /* [ */ && starts_with_bytes(bytes.subarray(ix), B_CDATA) && ix > scan_guard.cdata) {
    ix += B_CDATA.length;
    const x = memchr(0x5d /* ] */, bytes.subarray(ix));
    ix = x === undefined ? bytes.length : ix + x;
    const close_brackets = scan_ch_repeat(bytes.subarray(ix), 0x5d /* ] */);
    ix += close_brackets;

    if (close_brackets === 0 || scan_ch(bytes.subarray(ix), 0x3e /* > */) === 0) {
      scan_guard.cdata = ix;
      return undefined;
    } else {
      return ix + 1;
    }
  }
  // A declaration consists of the string `<!`, an ASCII letter, zero or more characters not
  // including the character >, and the character >.
  else if (is_ascii_alphabetic(c) && ix > scan_guard.declaration) {
    const x = memchr(0x3e /* > */, bytes.subarray(ix));
    ix = x === undefined ? bytes.length : ix + x;
    if (scan_ch(bytes.subarray(ix), 0x3e /* > */) === 0) {
      scan_guard.declaration = ix;
      return undefined;
    } else {
      return ix + 1;
    }
  } else {
    return undefined;
  }
}

// b"CDATA["
const B_CDATA = new Uint8Array([0x43, 0x44, 0x41, 0x54, 0x41, 0x5b]);

/** `<[u8]>::starts_with` */
function starts_with_bytes(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length > hay.length) return false;
  for (let k = 0; k < needle.length; k++) if (hay[k] !== needle[k]) return false;
  return true;
}

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1461 scan_inline_html_processing
/// Scan processing directive, with initial "<?" already consumed.
/// Returns the next byte offset on success.
export function scan_inline_html_processing(bytes: Uint8Array, ix: number, scan_guard: HtmlScanGuard): number | undefined {
  if (ix <= scan_guard.processing) {
    return undefined;
  }
  for (let offset = memchr(0x3f /* ? */, bytes.subarray(ix)); offset !== undefined; offset = memchr(0x3f /* ? */, bytes.subarray(ix))) {
    ix += offset + 1;
    if (scan_ch(bytes.subarray(ix), 0x3e /* > */) === 1) {
      return ix + 1;
    }
  }
  scan_guard.processing = ix;
  return undefined;
}
