// Port of compiler/rustc_errors/src/markdown/term.rs.
// PORT: `write!(buf, ..)` on the `Vec<u8>` is `buf.write_fmt([..pieces])`; `{style}` is `Style::render` and
// `{style:#}` is `Style::render_reset` (anstyle's `Display for Style`). `write_wrapping` indexes its text by byte, so it
// works on a `Str` (UTF-8 bytes) of it. The private items upstream's `tests` child module uses (`WIDTH`,
// `write_wrapping`) are exported for tests/term.test.ts.
import { is_whitespace } from "../../std/char.ts";
import { type IoResult } from "../../std/io.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { Str, str_chars_count, str_get, str_trim_start, utf8 } from "../../std/str.ts";
import { AnsiColor, Effects, Style } from "../../vendor/anstyle/lib.ts";
import type { VecU8 } from "../../vendor/anstream/stream.ts";
import type { Formatter, MdStream, MdTree } from "./mod.ts";

const DEFAULT_COLUMN_WIDTH: number = 140;

// thread_local! {
/// Track the position of viewable characters in our buffer
let CURSOR: number = 0;
/// Width of the terminal
let WIDTH: number = DEFAULT_COLUMN_WIDTH;
// }

/** `WIDTH.with(|w| w.set(width))` (the unit tests) */
export function WIDTH_set(width: number): void {
  WIDTH = width;
}

/// Print to the terminal output to a buffer
/// optionally with a formatter for code blocks
// rustc: compiler/rustc_errors/src/markdown/term.rs:20 entrypoint
export function entrypoint(stream: MdStream, buf: VecU8, formatter: Formatter | undefined): IoResult<void> {
  const r = write_stream(stream, buf, undefined, 0, formatter);
  if (r.$ === "Err") return r;
  return buf.write_all(utf8("\n"));
}

/// Write the buffer, reset to the default style after each,
/// optionally with a formatter for code blocks
// rustc: compiler/rustc_errors/src/markdown/term.rs:31 write_stream
function write_stream(stream_: MdStream, buf: VecU8, default_: Style | undefined, indent: number, formatter: Formatter | undefined): IoResult<void> {
  const stream = stream_._0;
  for (const tt of stream) {
    const r = write_tt(tt, buf, default_, indent, formatter);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

// rustc: compiler/rustc_errors/src/markdown/term.rs:45 write_tt
function write_tt(tt: MdTree, buf: VecU8, default_: Style | undefined, indent: number, formatter: Formatter | undefined): IoResult<void> {
  let r: IoResult<void>;
  switch (tt.$) {
    case "CodeBlock": {
      const txt = tt.txt;
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if (formatter !== undefined) {
        if ((r = formatter(txt, buf)).$ === "Err") return r;
      } else {
        const style = Style.effects(Style.new(), Effects.DIMMED);
        if ((r = buf.write_fmt([Style.render(style), txt, Style.render_reset(style)])).$ === "Err") return r;
      }
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      break;
    }
    case "CodeInline": {
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = write_wrapping(buf, tt._0, indent, undefined, Style.effects(Style.new(), Effects.DIMMED))).$ === "Err") return r;
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      break;
    }
    case "Strong": {
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = write_wrapping(buf, tt._0, indent, undefined, Style.effects(Style.new(), Effects.BOLD))).$ === "Err") return r;
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      break;
    }
    case "Emphasis": {
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = write_wrapping(buf, tt._0, indent, undefined, Style.effects(Style.new(), Effects.ITALIC))).$ === "Err") return r;
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      break;
    }
    case "Strikethrough": {
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = write_wrapping(buf, tt._0, indent, undefined, Style.effects(Style.new(), Effects.STRIKETHROUGH))).$ === "Err") return r;
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      break;
    }
    case "PlainText": {
      if ((r = write_wrapping(buf, tt._0, indent, undefined, undefined)).$ === "Err") return r;
      break;
    }
    case "Link": {
      if ((r = write_wrapping(buf, tt.disp, indent, tt.link, undefined)).$ === "Err") return r;
      break;
    }
    case "ParagraphBreak": {
      if ((r = buf.write_all(utf8("\n\n"))).$ === "Err") return r;
      reset_cursor();
      break;
    }
    case "LineBreak": {
      if ((r = buf.write_all(utf8("\n"))).$ === "Err") return r;
      reset_cursor();
      break;
    }
    case "HorizontalRule": {
      for (let i = 0; i < WIDTH; i++) {
        const w = buf.write_all(utf8("-"));
        if (w.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value`);
      }
      reset_cursor();
      break;
    }
    case "Heading": {
      const n = tt._0;
      const stream = tt._1;
      let cs: Style;
      if (n === 1) cs = Style.effects(AnsiColor.on_default(AnsiColor.BrightCyan), Effects.insert(Effects.BOLD, Effects.UNDERLINE));
      else if (n === 2) cs = Style.effects(AnsiColor.on_default(AnsiColor.BrightCyan), Effects.UNDERLINE);
      else if (n === 3) cs = Style.effects(AnsiColor.on_default(AnsiColor.BrightCyan), Effects.ITALIC);
      else if (n >= 4) cs = Style.effects(AnsiColor.on_default(AnsiColor.Cyan), Effects.insert(Effects.UNDERLINE, Effects.ITALIC));
      else cs = unreachable(); // 0
      if ((r = reset_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = buf.write_fmt([Style.render(cs)])).$ === "Err") return r;
      if ((r = write_stream(stream, buf, cs, 0, undefined)).$ === "Err") return r;
      if ((r = buf.write_fmt([Style.render_reset(cs)])).$ === "Err") return r;
      if ((r = render_opt_style(buf, default_)).$ === "Err") return r;
      if ((r = buf.write_all(utf8("\n"))).$ === "Err") return r;
      break;
    }
    case "OrderedListItem": {
      const base = `${tt._0}. `;
      if ((r = write_wrapping(buf, base.padEnd(4), indent, undefined, undefined)).$ === "Err") return r;
      if ((r = write_stream(tt._1, buf, undefined, indent + 4, undefined)).$ === "Err") return r;
      break;
    }
    case "UnorderedListItem": {
      const base = "* ";
      if ((r = write_wrapping(buf, base.padEnd(4), indent, undefined, undefined)).$ === "Err") return r;
      if ((r = write_stream(tt._0, buf, undefined, indent + 4, undefined)).$ === "Err") return r;
      break;
    }
    // Patterns popped in previous step
    case "Comment":
    case "LinkDef":
    case "RefLink":
      return unreachable();
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_errors/src/markdown/term.rs:139 render_opt_style
function render_opt_style(buf: VecU8, style: Style | undefined): IoResult<void> {
  if (style !== undefined) {
    const r = buf.write_fmt([Style.render(style)]);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

// rustc: compiler/rustc_errors/src/markdown/term.rs:146 reset_opt_style
function reset_opt_style(buf: VecU8, style: Style | undefined): IoResult<void> {
  if (style !== undefined) {
    const r = buf.write_fmt([Style.render_reset(style)]);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

/// End of that block, just wrap the line
// rustc: compiler/rustc_errors/src/markdown/term.rs:154 reset_cursor
function reset_cursor(): void {
  CURSOR = 0;
}

/** The bytes of a `Str`. */
function bytes_of(s: Str): Uint8Array {
  return s.b.subarray(s.lo, s.hi);
}

/** `writeln!(buf, "{}", s)` */
function writeln_str(buf: VecU8, s: Str): IoResult<void> {
  const r = buf.write_all(bytes_of(s));
  if (r.$ === "Err") return r;
  return buf.write_all(utf8("\n"));
}

/**
 * `str::char_indices` as Rust's lazy iterator: `(byte index, char)` pairs are decoded only as far as they are asked for,
 * so `write_wrapping` decodes about one line's chars per line, not the whole remaining text (docs/reviews/driver-cli.md
 * N5). Indices are positions in the iteration (`get(n)` is what `nth(n)` on a fresh iterator returns).
 */
class CharIndices {
  private readonly items: [number, number][] = [];
  private readonly chars: ReturnType<Str["chars"]>;
  constructor(private readonly s: Str) {
    this.chars = s.chars();
  }
  get(n: number): [number, number] | undefined {
    while (this.items.length <= n) {
      const pos = this.chars.pos;
      const c = this.chars.next();
      if (c === undefined) return undefined;
      this.items.push([pos - this.s.lo, c]);
    }
    return this.items[n];
  }
}

const C_UNDERSCORE = 0x5f;
const C_HYPHEN = 0x2d;
const IND_WS: Uint8Array = utf8("          ");

/// Change to be generic on Write for testing. If we have a link URL, we don't
/// count the extra tokens to make it clickable.
// rustc: compiler/rustc_errors/src/markdown/term.rs:160 write_wrapping
export function write_wrapping(buf: VecU8, text: string, indent: number, link_url: string | undefined, style: Style | undefined): IoResult<void> {
  let r: IoResult<void>;
  if ((r = render_opt_style(buf, style)).$ === "Err") return r;

  if (indent > IND_WS.length) return panic(`range end index ${indent} out of range for slice of length ${IND_WS.length}`);
  const ind_ws = IND_WS.subarray(0, indent);
  let to_write = Str.from(text);
  if (link_url !== undefined) {
    const url = link_url;
    // This is a nonprinting prefix so we don't increment our cursor
    if ((r = buf.write_fmt([`\x1b]8;;${url}\x1b\\`])).$ === "Err") return r;
  }
  // CURSOR.with(|cur| {
  for (;;) {
    if (CURSOR === 0) {
      if ((r = buf.write_all(ind_ws)).$ === "Err") return r;
      CURSOR = indent;
    }
    // PORT: `usize` subtraction; `CURSOR` never exceeds `WIDTH` (it grows by at most `ch_count` below).
    const ch_count = WIDTH - CURSOR;
    const iter = new CharIndices(to_write);
    let iter_pos = 0;
    // `iter.nth(ch_count)`
    const nth = iter.get(ch_count);
    if (nth === undefined) {
      // Write entire line
      if ((r = buf.write_all(bytes_of(to_write))).$ === "Err") return r;
      CURSOR = CURSOR + str_chars_count(to_write);
      break;
    }
    const [end_idx, _ch] = nth;
    iter_pos = ch_count + 1;

    // `to_write[..end_idx].char_indices().rev().find(|(_idx, ch)| ch.is_whitespace() || ['_', '-'].contains(ch))`
    let found: [number, number] | undefined;
    for (let i = ch_count - 1; i >= 0; i--) {
      const [idx, ch] = iter.get(i)!;
      if (is_whitespace(ch) || ch === C_UNDERSCORE || ch === C_HYPHEN) {
        found = [idx, ch];
        break;
      }
    }
    if (found !== undefined) {
      const [break_idx, ch] = found;
      // Found whitespace to break at
      if (is_whitespace(ch)) {
        if ((r = writeln_str(buf, to_write.slice(0, break_idx))).$ === "Err") return r;
        to_write = str_trim_start(to_write.slice(break_idx));
      } else {
        // Break at a `-` or `_` separator
        if ((r = writeln_str(buf, str_get(to_write, 0, break_idx + 1) ?? to_write)).$ === "Err") return r;
        to_write = str_trim_start(str_get(to_write, break_idx + 1, to_write.len()) ?? Str.from(""));
      }
    } else {
      // No whitespace, we need to just split
      let ws_idx = to_write.len();
      for (let e = iter.get(iter_pos); e !== undefined; e = iter.get(++iter_pos)) {
        const [idx, ch] = e;
        if (is_whitespace(ch)) {
          ws_idx = idx;
          break;
        }
      }
      if ((r = writeln_str(buf, to_write.slice(0, ws_idx))).$ === "Err") return r;
      const rest = ws_idx + 1 <= to_write.len() ? str_get(to_write, ws_idx + 1, to_write.len()) : undefined;
      to_write = rest === undefined ? Str.from("") : str_trim_start(rest);
    }
    CURSOR = 0;
  }
  if (link_url !== undefined) {
    if ((r = buf.write_all(utf8("\x1b]8;;\x1b\\"))).$ === "Err") return r;
  }
  if ((r = reset_opt_style(buf, style)).$ === "Err") return r;
  return Ok(undefined);
  // })
}
