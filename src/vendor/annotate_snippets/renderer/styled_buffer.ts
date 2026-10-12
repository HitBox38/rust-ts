// Port of annotate-snippets =0.12.16 `src/renderer/styled_buffer.rs`.
//
//! Adapted from [styled_buffer]
//!
//! [styled_buffer]: https://github.com/rust-lang/rust/blob/894f7a4ba6554d3797404bbf550d9919df060b97/compiler/rustc_errors/src/styled_buffer.rs
//
// PORT: `StyledChar` is `Copy` → a readonly interface; `StyledChar::SPACE` is one shared frozen
// object, so writes through `&mut StyledChar` replace the array element instead of mutating it.
// PORT: `&str` parameters are JS strings (iterated by code point, like `str::chars`); callers
// holding a `Str` pass `.toString()`. `str: &mut String` is a `{ value: string }` cell, and
// `Result<(), fmt::Error>` is `Result<undefined, never>` (writing to a String cannot fail).

import { Style, Style_eq } from "../../anstyle/style.ts";
import { debug_char, debug_struct, debug_vec, PLAIN, PRETTY, type Debug } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import type { Level } from "../level.ts";
import { index } from "../std_ext.ts";
import { debug_ElementStyle, ElementStyle } from "./render.ts";
import type { Stylesheet } from "./stylesheet.ts";

export class StyledBuffer {
  constructor(public lines: StyledChar[][]) {}

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:33 new
  static new(): StyledBuffer {
    return new StyledBuffer([]);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:37 ensure_lines
  ensure_lines(line: number): void {
    if (line >= this.lines.length) {
      while (this.lines.length < line + 1) this.lines.push([]);
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:43 render
  render(level: Level, stylesheet: Stylesheet, str: { value: string }): Result<undefined, never> {
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]!;
      let current_style = stylesheet.none;
      for (const { ch, style } of line) {
        const ch_style = ElementStyle.color_spec(style, level, stylesheet);
        if (!Style_eq(ch_style, current_style)) {
          if (line.length !== 0) {
            str.value += Style.fmt(current_style, PRETTY); // write!(str, "{current_style:#}")
          }
          current_style = ch_style;
          str.value += Style.fmt(current_style, PLAIN); // write!(str, "{current_style}")
        }
        str.value += String.fromCodePoint(ch);
      }
      str.value += Style.fmt(current_style, PRETTY); // write!(str, "{current_style:#}")
      if (i !== this.lines.length - 1) {
        str.value += "\n";
      }
    }
    return Ok(undefined);
  }

  /// Sets `chr` with `style` for given `line`, `col`.
  /// If `line` does not exist in our buffer, adds empty lines up to the given
  /// and fills the last line with unstyled whitespace.
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:73 putc
  putc(line: number, col: number, chr: number, style: ElementStyle): void {
    this.ensure_lines(line);
    const l = this.lines[line]!;
    if (col >= l.length) {
      while (l.length < col + 1) l.push(StyledChar.SPACE);
    }
    l[col] = StyledChar.new(chr, style);
  }

  /// Sets `string` with `style` for given `line`, starting from `col`.
  /// If `line` does not exist in our buffer, adds empty lines up to the given
  /// and fills the last line with unstyled whitespace.
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:84 puts
  puts(line: number, col: number, string: string, style: ElementStyle): void {
    let offset = 0;
    for (const c of string) {
      this.putc(line, col + offset, c.codePointAt(0)!, style);
      offset++;
    }
  }

  /// For given `line` inserts `string` with `style` after old content of that line,
  /// adding lines if needed
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:92 append
  append(line: number, string: string, style: ElementStyle): void {
    if (line >= this.lines.length) {
      this.puts(line, 0, string, style);
    } else {
      const col = this.lines[line]!.length;
      this.puts(line, col, string, style);
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:101 replace
  replace(line: number, start: number, end: number, string: string): void {
    if (start === end) {
      return;
    }
    // If the replacement range would be out of bounds, do nothing, as we
    // can't replace things that don't exist.
    const l = index(this.lines, line);
    if (start > l.length || end > l.length) {
      return;
    }
    // PORT: `Vec::splice(start..end, ..)` panics when start > end; JS `splice` would not.
    if (start > end) panic(`slice index starts at ${start} but ends at ${end}`);
    l.splice(
      start,
      end - start,
      ...Array.from(string, (c) => StyledChar.new(c.codePointAt(0)!, ElementStyle.LineNumber)),
    );
  }

  /// For given `line` inserts `string` with `style` before old content of that line,
  /// adding lines if needed
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:120 prepend
  prepend(line: number, string: string, style: ElementStyle): void {
    this.ensure_lines(line);
    let string_len = 0;
    for (const _ of string) string_len++;

    const l = this.lines[line]!;
    if (l.length !== 0) {
      // Push the old content over to make room for new content
      for (let i = 0; i < string_len; i++) {
        l.unshift(StyledChar.SPACE);
      }
    }

    this.puts(line, 0, string, style);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:134 num_lines
  num_lines(): number {
    return this.lines.length;
  }

  /// Set `style` for `line`, `col_start..col_end` range if:
  /// 1. That line and column range exist in `StyledBuffer`
  /// 2. `overwrite` is `true` or existing style is `Style::NoStyle` or `Style::Quotation`
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:141 set_style_range
  set_style_range(line: number, col_start: number, col_end: number, style: ElementStyle, overwrite: boolean): void {
    for (let col = col_start; col < col_end; col++) {
      this.set_style(line, col, style, overwrite);
    }
  }

  /// Set `style` for `line`, `col` if:
  /// 1. That line and column exist in `StyledBuffer`
  /// 2. `overwrite` is `true` or existing style is `Style::NoStyle` or `Style::Quotation`
  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:157 set_style
  set_style(line: number, col: number, style: ElementStyle, overwrite: boolean): void {
    const l = this.lines[line];
    if (l !== undefined) {
      const c = l[col];
      if (c !== undefined) {
        const s = c.style;
        if (overwrite || s.$ === "NoStyle" || s.$ === "Quotation") {
          l[col] = StyledChar.new(c.ch, style); // *s = style
        }
      }
    }
  }
}

export const debug_StyledBuffer: Debug<StyledBuffer> = (v, f) =>
  debug_struct(f, "StyledBuffer", [["lines", debug_vec(v.lines, f, (l: StyledChar[], f) => debug_vec(l, f, debug_StyledChar))]]);

export interface StyledChar {
  readonly ch: number;
  readonly style: ElementStyle;
}

let SPACE: StyledChar | undefined;

export const StyledChar = {
  // PORT: `const SPACE` is built on first use: render.ts and this module import each other, so
  // `ElementStyle` may not be initialised yet while this module is evaluated.
  get SPACE(): StyledChar {
    return (SPACE ??= Object.freeze(StyledChar.new(0x20 /* ' ' */, ElementStyle.NoStyle)));
  },

  // crate: annotate-snippets-0.12.16/src/renderer/styled_buffer.rs:27 new
  new(ch: number, style: ElementStyle): StyledChar {
    return { ch, style };
  },
};

export const debug_StyledChar: Debug<StyledChar> = (v, f) =>
  debug_struct(f, "StyledChar", [
    ["ch", debug_char(v.ch)],
    ["style", debug_ElementStyle(v.style, f)],
  ]);
