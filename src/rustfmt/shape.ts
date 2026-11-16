// Port of src/tools/rustfmt/src/shape.rs (lane rustfmt-contract-1).
import type { Config } from "./config/mod.ts";
import type { ExceedsMaxWidthError } from "../rustfmt/rewrite.ts";
import type { Span } from "../rustc_span/lib.ts";
import { type Debug, debug_int, debug_struct } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

/** `a - b` on usize. PORT: rustfmt ships without overflow checks, so an underflow wraps to a value past 2^53, which a
 *  `number` cannot hold: the port stops there instead of guessing. */
function usize_sub(a: number, b: number): number {
  const r = a - b;
  return r < 0 ? unported("usize wrapping subtraction in rustfmt's shape.rs (overflow checks are off)") : r;
}
/** `usize::saturating_sub` */
function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

// `#[derive(Copy, Clone, Debug)]`: a value type; every method returns a new `Indent` where Rust copies.
export class Indent {
  constructor(
    // Width of the block indent, in characters. Must be a multiple of
    // Config::tab_spaces.
    public block_indent: number,
    // Alignment in characters.
    public alignment: number,
  ) {}

  // rustc: src/tools/rustfmt/src/shape.rs:25 new
  static new(block_indent: number, alignment: number): Indent {
    return new Indent(block_indent, alignment);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:32 from_width
  static from_width(config: Config, width: number): Indent {
    if (config.hard_tabs()) {
      const tab_num = Math.floor(width / config.tab_spaces());
      const alignment = width % config.tab_spaces();
      return Indent.new(config.tab_spaces() * tab_num, alignment);
    } else {
      return Indent.new(width, 0);
    }
  }

  // rustc: src/tools/rustfmt/src/shape.rs:42 empty
  static empty(): Indent {
    return Indent.new(0, 0);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:46 block_only
  block_only(): Indent {
    return new Indent(this.block_indent, 0);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:53 block_indent
  block_indent_(config: Config): Indent {
    // PORT: `mut self` (a copy); renamed `block_indent_`: the class has a field `block_indent`.
    return new Indent(this.block_indent + config.tab_spaces(), this.alignment);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:58 block_unindent
  block_unindent(config: Config): Indent {
    if (this.block_indent < config.tab_spaces()) {
      return Indent.new(this.block_indent, 0);
    } else {
      return new Indent(this.block_indent - config.tab_spaces(), this.alignment);
    }
  }

  // rustc: src/tools/rustfmt/src/shape.rs:67 width
  width(): number {
    return this.block_indent + this.alignment;
  }

  // rustc: src/tools/rustfmt/src/shape.rs:71 to_string
  to_string(config: Config): string {
    return this.to_string_inner(config, 1);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:75 to_string_with_newline
  to_string_with_newline(config: Config): string {
    return this.to_string_inner(config, 0);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:79 to_string_inner
  to_string_inner(config: Config, offset: number): string {
    let num_tabs: number;
    let num_spaces: number;
    if (config.hard_tabs()) {
      [num_tabs, num_spaces] = [Math.floor(this.block_indent / config.tab_spaces()), this.alignment];
    } else {
      [num_tabs, num_spaces] = [0, this.width()];
    }
    const num_chars = num_tabs + num_spaces;
    if (num_tabs === 0 && num_chars + offset <= INDENT_BUFFER_LEN) {
      return INDENT_BUFFER.slice(offset, num_chars + 1);
    } else {
      let indent = "";
      if (offset === 0) {
        indent += "\n";
      }
      indent += "\t".repeat(num_tabs);
      indent += " ".repeat(num_spaces);
      return indent;
    }
  }

  // `impl Add for Indent`
  // rustc: src/tools/rustfmt/src/shape.rs:107 add
  add(rhs: Indent): Indent {
    return new Indent(this.block_indent + rhs.block_indent, this.alignment + rhs.alignment);
  }

  // `impl Sub for Indent`
  // rustc: src/tools/rustfmt/src/shape.rs:118 sub
  sub(rhs: Indent): Indent {
    return Indent.new(usize_sub(this.block_indent, rhs.block_indent), usize_sub(this.alignment, rhs.alignment));
  }

  // `impl Add<usize> for Indent`
  // rustc: src/tools/rustfmt/src/shape.rs:129 add
  add_usize(rhs: number): Indent {
    return Indent.new(this.block_indent, this.alignment + rhs);
  }

  // `impl Sub<usize> for Indent`
  // rustc: src/tools/rustfmt/src/shape.rs:137 sub
  sub_usize(rhs: number): Indent {
    return Indent.new(this.block_indent, usize_sub(this.alignment, rhs));
  }
}
export const debug_Indent: Debug<Indent> = (v, f) =>
  debug_struct(f, "Indent", [
    ["block_indent", debug_int(v.block_indent, f)],
    ["alignment", debug_int(v.alignment, f)],
  ]);

// INDENT_BUFFER.len() = 81
const INDENT_BUFFER_LEN = 80;
const INDENT_BUFFER = "\n                                                                                ";

// 8096 is close enough to infinite for rustfmt.
const INFINITE_SHAPE_WIDTH = 8096;

// `#[derive(Copy, Clone, Debug)]`: a value type; every method returns a new `Shape` where Rust copies (`..*self`).
export class Shape {
  constructor(
    public width: number,
    // The current indentation of code.
    public indent: Indent,
    // Indentation + any already emitted text on the first line of the current
    // statement.
    public offset: number,
  ) {}

  /// `indent` is the indentation of the first line. The next lines
  /// should begin with at least `indent` spaces (except backwards
  /// indentation). The first line should not begin with indentation.
  /// `width` is the maximum number of characters on the last line
  /// (excluding `indent`). The width of other lines is not limited by
  /// `width`.
  /// Note that in reality, we sometimes use width for lines other than the
  /// last (i.e., we are conservative).
  // .......*-------*
  //        |       |
  //        |     *-*
  //        *-----|
  // |<------------>|  max width
  // |<---->|          indent
  //        |<--->|    width
  // rustc: src/tools/rustfmt/src/shape.rs:171 legacy
  static legacy(width: number, indent: Indent): Shape {
    return new Shape(width, indent, indent.alignment);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:179 indented
  static indented(indent: Indent, config: Config): Shape {
    return new Shape(saturating_sub(config.max_width(), indent.width()), indent, indent.alignment);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:187 with_max_width
  with_max_width(config: Config): Shape {
    return new Shape(saturating_sub(config.max_width(), this.indent.width()), this.indent, this.offset);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:194 visual_indent
  visual_indent(delta: number): Shape {
    const alignment = this.offset + delta;
    return new Shape(this.width, Indent.new(this.indent.block_indent, alignment), alignment);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:203 block_indent
  block_indent(delta: number): Shape {
    if (this.indent.alignment === 0) {
      return new Shape(this.width, Indent.new(this.indent.block_indent + delta, 0), 0);
    } else {
      return new Shape(this.width, this.indent.add_usize(delta), this.indent.alignment + delta);
    }
  }

  // rustc: src/tools/rustfmt/src/shape.rs:219 block_left
  block_left(delta: number, span: Span): Result<Shape, ExceedsMaxWidthError> {
    return this.block_indent(delta).sub_width(delta, span);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:227 add_offset
  add_offset(delta: number): Shape {
    return new Shape(this.width, this.indent, this.offset + delta);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:234 block
  block(): Shape {
    return new Shape(this.width, this.indent.block_only(), this.offset);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:241 saturating_sub_width
  saturating_sub_width(delta: number): Shape {
    return new Shape(saturating_sub(this.width, delta), this.indent, this.offset);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:248 sub_width
  sub_width(delta: number, span: Span): Result<Shape, ExceedsMaxWidthError> {
    const s = this.sub_width_opt(delta);
    return s !== undefined ? Ok(s) : Err(this.exceeds_max_width_error(span));
  }

  // rustc: src/tools/rustfmt/src/shape.rs:257 sub_width_opt
  sub_width_opt(delta: number): Shape | undefined {
    // `checked_sub`
    return this.width >= delta ? new Shape(this.width - delta, this.indent, this.offset) : undefined;
  }

  // rustc: src/tools/rustfmt/src/shape.rs:263 shrink_left
  shrink_left(delta: number, span: Span): Result<Shape, ExceedsMaxWidthError> {
    const s = this.shrink_left_opt(delta);
    return s !== undefined ? Ok(s) : Err(this.exceeds_max_width_error(span));
  }

  // rustc: src/tools/rustfmt/src/shape.rs:272 shrink_left_opt
  shrink_left_opt(delta: number): Shape | undefined {
    return this.width >= delta ? new Shape(this.width - delta, this.indent.add_usize(delta), this.offset + delta) : undefined;
  }

  // rustc: src/tools/rustfmt/src/shape.rs:280 offset_left
  offset_left(delta: number, span: Span): Result<Shape, ExceedsMaxWidthError> {
    const s = this.offset_left_opt(delta);
    return s !== undefined ? Ok(s) : Err(this.exceeds_max_width_error(span));
  }

  // rustc: src/tools/rustfmt/src/shape.rs:289 offset_left_opt
  offset_left_opt(delta: number): Shape | undefined {
    return this.add_offset(delta).sub_width_opt(delta);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:293 used_width
  used_width(): number {
    return this.indent.block_indent + this.offset;
  }

  // rustc: src/tools/rustfmt/src/shape.rs:297 rhs_overhead
  rhs_overhead(config: Config): number {
    return saturating_sub(config.max_width(), this.used_width() + this.width);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:303 comment
  comment(config: Config): Shape {
    const width = Math.min(this.width, saturating_sub(config.comment_width(), this.indent.width()));
    return new Shape(width, this.indent, this.offset);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:311 to_string_with_newline
  to_string_with_newline(config: Config): string {
    const offset_indent = new Indent(this.indent.block_indent, this.indent.alignment);
    offset_indent.alignment = this.offset;
    return offset_indent.to_string_inner(config, 0);
  }

  /// Creates a `Shape` with a virtually infinite width.
  // rustc: src/tools/rustfmt/src/shape.rs:318 infinite_width
  infinite_width(): Shape {
    return new Shape(INFINITE_SHAPE_WIDTH, this.indent, this.offset);
  }

  // rustc: src/tools/rustfmt/src/shape.rs:325 exceeds_max_width_error
  exceeds_max_width_error(span: Span): ExceedsMaxWidthError {
    return { configured_width: this.width, span };
  }
}
export const debug_Shape: Debug<Shape> = (v, f) =>
  debug_struct(f, "Shape", [
    ["width", debug_int(v.width, f)],
    ["indent", debug_Indent(v.indent, f)],
    ["offset", debug_int(v.offset, f)],
  ]);
