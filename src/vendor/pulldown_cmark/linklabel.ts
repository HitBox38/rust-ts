// Port of pulldown-cmark-0.11.3/src/linklabel.rs.
// Copyright 2018 Google LLC
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

//! Link label parsing and matching.

import type { Str } from "../../std/str.ts";
import { UniCase } from "../unicase/lib.ts";
import { is_ascii_punctuation, is_ascii_whitespace, scan_eol } from "./scanners.ts";
import type { CowStr } from "./strings.ts";

export type ReferenceLabel = { $: "Link"; _0: CowStr } | { $: "Footnote"; _0: CowStr };

// PORT: `UniCase<CowStr<'a>>`; maps keyed by it use `UniCase_key` (vendor/unicase/lib.ts).
export type LinkLabel = UniCase;

export type FootnoteLabel = UniCase;

const ASCII_WS = new Set([0x20, 0x0d, 0x0a, 0x09]);

// crate: pulldown-cmark-0.11.3/src/linklabel.rs:44 scan_link_label_rest
/// Assumes the opening bracket has already been scanned.
/// The line break handler determines what happens when a linebreak
/// is found. It is passed the bytes following the line break and
/// either returns `Some(k)`, where `k` is the number of bytes to skip,
/// or `None` to abort parsing the label.
/// Returns the number of bytes read (including closing bracket) and label on success.
export function scan_link_label_rest(
  text: Str,
  linebreak_handler: (bytes: Uint8Array) => number | undefined,
  is_in_table: boolean,
): [number, CowStr] | undefined {
  const bytes = text.b.subarray(text.lo, text.hi);
  let ix = 0;
  let only_white_space = true;
  let codepoints = 0;
  // no worries, doesn't allocate until we push things onto it
  let label = "";
  let mark = 0;

  for (;;) {
    if (codepoints >= 1000) {
      return undefined;
    }
    const b = bytes[ix];
    if (b === undefined) return undefined;
    if (b === 0x5b /* [ */) {
      return undefined;
    } else if (b === 0x5d /* ] */) {
      break;
    } else if (b === 0x7c /* | */ && is_in_table && ix !== 0 && bytes[ix - 1] === 0x5c /* \ */) {
      // Backslash escapes in link references are normally untouched, but
      // tables are an exception, because they're parsed as-if the tables
      // were parsed in a discrete pass, changing `\|` to `|`, and then
      // passing the changed string to the inline parser.
      // only way to reach this spot is to have `\\|` (even number of `\` before `|`)
      label += text.slice(mark, ix - 1).toString();
      label += "|";
      ix += 1;
      only_white_space = false;
      mark = ix;
    } else if (b === 0x5c /* \ */ && is_in_table && bytes[ix + 1] === 0x7c /* | */) {
      // only way to reach this spot is to have `\|` (odd number of `\` before `|`)
      label += text.slice(mark, ix).toString();
      label += "|";
      ix += 2;
      codepoints += 1;
      only_white_space = false;
      mark = ix;
    } else if (b === 0x5c /* \ */ && (bytes[ix + 1] === undefined || is_ascii_punctuation(bytes[ix + 1]!))) {
      // the guard's `*bytes.get(ix + 1)?` returns None from the whole fn when out of bounds
      if (bytes[ix + 1] === undefined) return undefined;
      ix += 2;
      codepoints += 2;
      only_white_space = false;
    } else if (is_ascii_whitespace(b)) {
      // normalize labels by collapsing whitespaces, including linebreaks
      let whitespaces = 0;
      let linebreaks = 0;
      const whitespace_start = ix;

      while (ix < bytes.length && is_ascii_whitespace(bytes[ix]!)) {
        const eol_bytes = scan_eol(bytes.subarray(ix));
        if (eol_bytes !== undefined) {
          linebreaks += 1;
          if (linebreaks > 1) {
            return undefined;
          }
          ix += eol_bytes;
          const k = linebreak_handler(bytes.subarray(ix));
          if (k === undefined) return undefined;
          ix += k;
          whitespaces += 2; // indicate that we need to replace
        } else {
          whitespaces += bytes[ix] === 0x20 ? 1 : 2;
          ix += 1;
        }
      }
      if (whitespaces > 1) {
        label += text.slice(mark, whitespace_start).toString();
        label += " ";
        mark = ix;
        codepoints += ix - whitespace_start;
      } else {
        codepoints += 1;
      }
    } else {
      only_white_space = false;
      ix += 1;
      if ((b & 0b1000_0000) !== 0) {
        codepoints += 1;
      }
    }
  }

  if (only_white_space) {
    return undefined;
  } else {
    let cow: CowStr;
    if (mark === 0) {
      // `text[..ix].trim_matches(&[' ', '\r', '\n', '\t'][..])`
      let lo = 0;
      let hi = ix;
      while (lo < hi && ASCII_WS.has(bytes[lo]!)) lo++;
      while (hi > lo && ASCII_WS.has(bytes[hi - 1]!)) hi--;
      cow = text.slice(lo, hi).toString();
    } else {
      label += text.slice(mark, ix).toString();
      let lo = 0;
      let hi = label.length;
      while (hi > lo && ASCII_WS.has(label.charCodeAt(hi - 1))) hi--;
      while (lo < hi && ASCII_WS.has(label.charCodeAt(lo))) lo++;
      cow = label.slice(lo, hi);
    }
    return [ix + 1, cow];
  }
}
