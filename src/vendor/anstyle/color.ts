// Port of anstyle =1.0.13 `src/color.rs`.
//
// PORT: `impl From<X> for Color` (and for `Ansi256Color`/`RgbColor`) → `from_<X>` functions;
// parameters typed `impl Into<Color>` take a `Color` (callers convert with those functions).
// `Ansi256Color(pub u8)` / `RgbColor(pub u8, pub u8, pub u8)` are classes with `_0`.. fields.

import { debug_str, debug_struct, debug_tuple, debug_list, type Debug, type Fmt } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import type { Write } from "./lib.ts";
import { Style } from "./style.ts";

/// Any ANSI color code scheme
export type Color =
  /// Available 4-bit ANSI color palette codes
  ///
  /// The user's terminal defines the meaning of the each palette code.
  | { readonly $: "Ansi"; readonly _0: AnsiColor }
  /// 256 (8-bit) color support
  ///
  /// - `0..16` are [`AnsiColor`] palette codes
  /// - `0..232` map to [`RgbColor`] color values
  /// - `232..` map to [`RgbColor`] gray-scale values
  | { readonly $: "Ansi256"; readonly _0: Ansi256Color }
  /// 24-bit ANSI RGB color codes
  | { readonly $: "Rgb"; readonly _0: RgbColor };

export const Color = {
  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:22 on
  on(self: Color, background: Color): Style {
    return Style.bg_color(Style.fg_color(Style.new(), self), background);
  },

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:30 on_default
  on_default(self: Color): Style {
    return Style.fg_color(Style.new(), self);
  },

  /// Render the ANSI code for a foreground color
  // crate: anstyle-1.0.13/src/color.rs:36 render_fg
  render_fg(self: Color): string {
    switch (self.$) {
      case "Ansi":
        return AnsiColor.as_fg_buffer(self._0).fmt(PLAIN);
      case "Ansi256":
        return self._0.as_fg_buffer().fmt(PLAIN);
      case "Rgb":
        return self._0.as_fg_buffer().fmt(PLAIN);
    }
  },

  // crate: anstyle-1.0.13/src/color.rs:46 write_fg_to
  write_fg_to(self: Color, write: Write): Result<undefined, unknown> {
    let buffer: DisplayBuffer;
    switch (self.$) {
      case "Ansi":
        buffer = AnsiColor.as_fg_buffer(self._0);
        break;
      case "Ansi256":
        buffer = self._0.as_fg_buffer();
        break;
      case "Rgb":
        buffer = self._0.as_fg_buffer();
        break;
    }
    return buffer.write_to(write);
  },

  /// Render the ANSI code for a background color
  // crate: anstyle-1.0.13/src/color.rs:57 render_bg
  render_bg(self: Color): string {
    switch (self.$) {
      case "Ansi":
        return AnsiColor.as_bg_buffer(self._0).fmt(PLAIN);
      case "Ansi256":
        return self._0.as_bg_buffer().fmt(PLAIN);
      case "Rgb":
        return self._0.as_bg_buffer().fmt(PLAIN);
    }
  },

  // crate: anstyle-1.0.13/src/color.rs:67 write_bg_to
  write_bg_to(self: Color, write: Write): Result<undefined, unknown> {
    let buffer: DisplayBuffer;
    switch (self.$) {
      case "Ansi":
        buffer = AnsiColor.as_bg_buffer(self._0);
        break;
      case "Ansi256":
        buffer = self._0.as_bg_buffer();
        break;
      case "Rgb":
        buffer = self._0.as_bg_buffer();
        break;
    }
    return buffer.write_to(write);
  },

  // crate: anstyle-1.0.13/src/color.rs:77 render_underline
  render_underline(self: Color): string {
    switch (self.$) {
      case "Ansi":
        return AnsiColor.as_underline_buffer(self._0).fmt(PLAIN);
      case "Ansi256":
        return self._0.as_underline_buffer().fmt(PLAIN);
      case "Rgb":
        return self._0.as_underline_buffer().fmt(PLAIN);
    }
  },

  // crate: anstyle-1.0.13/src/color.rs:87 write_underline_to
  write_underline_to(self: Color, write: Write): Result<undefined, unknown> {
    let buffer: DisplayBuffer;
    switch (self.$) {
      case "Ansi":
        buffer = AnsiColor.as_underline_buffer(self._0);
        break;
      case "Ansi256":
        buffer = self._0.as_underline_buffer();
        break;
      case "Rgb":
        buffer = self._0.as_underline_buffer();
        break;
    }
    return buffer.write_to(write);
  },

  // impl From<AnsiColor> for Color
  // crate: anstyle-1.0.13/src/color.rs:99 from
  from_AnsiColor(inner: AnsiColor): Color {
    return { $: "Ansi", _0: inner };
  },

  // impl From<Ansi256Color> for Color
  // crate: anstyle-1.0.13/src/color.rs:106 from
  from_Ansi256Color(inner: Ansi256Color): Color {
    return { $: "Ansi256", _0: inner };
  },

  // impl From<RgbColor> for Color
  // crate: anstyle-1.0.13/src/color.rs:113 from
  from_RgbColor(inner: RgbColor): Color {
    return { $: "Rgb", _0: inner };
  },

  // impl From<u8> for Color
  // crate: anstyle-1.0.13/src/color.rs:120 from
  from_u8(inner: number): Color {
    return { $: "Ansi256", _0: Ansi256Color.from_u8(inner) };
  },

  // impl From<(u8, u8, u8)> for Color
  // crate: anstyle-1.0.13/src/color.rs:127 from
  from_tuple(inner: readonly [number, number, number]): Color {
    return { $: "Rgb", _0: RgbColor.from_tuple(inner) };
  },
} as const;

/** `#[derive(PartialEq)] for Color` */
export function Color_eq(a: Color, b: Color): boolean {
  switch (a.$) {
    case "Ansi":
      return b.$ === "Ansi" && a._0 === b._0;
    case "Ansi256":
      return b.$ === "Ansi256" && a._0._0 === b._0._0;
    case "Rgb":
      return b.$ === "Rgb" && a._0._0 === b._0._0 && a._0._1 === b._0._1 && a._0._2 === b._0._2;
  }
}

export const debug_Color: Debug<Color> = (v, f) => {
  switch (v.$) {
    case "Ansi":
      return debug_tuple(f, "Ansi", [debug_AnsiColor(v._0, f)]);
    case "Ansi256":
      return debug_tuple(f, "Ansi256", [debug_Ansi256Color(v._0, f)]);
    case "Rgb":
      return debug_tuple(f, "Rgb", [debug_RgbColor(v._0, f)]);
  }
};

const PLAIN: Fmt = { alternate: false };

/// Available 4-bit ANSI color palette codes
///
/// The user's terminal defines the meaning of the each palette code.
export type AnsiColor =
  /// Black: #0 (foreground code `30`, background code `40`).
  | "Black"
  /// Red: #1 (foreground code `31`, background code `41`).
  | "Red"
  /// Green: #2 (foreground code `32`, background code `42`).
  | "Green"
  /// Yellow: #3 (foreground code `33`, background code `43`).
  | "Yellow"
  /// Blue: #4 (foreground code `34`, background code `44`).
  | "Blue"
  /// Magenta: #5 (foreground code `35`, background code `45`).
  | "Magenta"
  /// Cyan: #6 (foreground code `36`, background code `46`).
  | "Cyan"
  /// White: #7 (foreground code `37`, background code `47`).
  | "White"
  /// Bright black: #0 (foreground code `90`, background code `100`).
  | "BrightBlack"
  /// Bright red: #1 (foreground code `91`, background code `101`).
  | "BrightRed"
  /// Bright green: #2 (foreground code `92`, background code `102`).
  | "BrightGreen"
  /// Bright yellow: #3 (foreground code `93`, background code `103`).
  | "BrightYellow"
  /// Bright blue: #4 (foreground code `94`, background code `104`).
  | "BrightBlue"
  /// Bright magenta: #5 (foreground code `95`, background code `105`).
  | "BrightMagenta"
  /// Bright cyan: #6 (foreground code `96`, background code `106`).
  | "BrightCyan"
  /// Bright white: #7 (foreground code `97`, background code `107`).
  | "BrightWhite";

export const AnsiColor = {
  Black: "Black",
  Red: "Red",
  Green: "Green",
  Yellow: "Yellow",
  Blue: "Blue",
  Magenta: "Magenta",
  Cyan: "Cyan",
  White: "White",
  BrightBlack: "BrightBlack",
  BrightRed: "BrightRed",
  BrightGreen: "BrightGreen",
  BrightYellow: "BrightYellow",
  BrightBlue: "BrightBlue",
  BrightMagenta: "BrightMagenta",
  BrightCyan: "BrightCyan",
  BrightWhite: "BrightWhite",

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:191 on
  on(self: AnsiColor, background: Color): Style {
    return Style.bg_color(Style.fg_color(Style.new(), Color.from_AnsiColor(self)), background);
  },

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:199 on_default
  on_default(self: AnsiColor): Style {
    return Style.fg_color(Style.new(), { $: "Ansi", _0: self });
  },

  /// Render the ANSI code for a foreground color
  // crate: anstyle-1.0.13/src/color.rs:205 render_fg
  render_fg(self: AnsiColor): string {
    return new NullFormatter(AnsiColor.as_fg_str(self)).fmt(PLAIN);
  },

  // crate: anstyle-1.0.13/src/color.rs:210 as_fg_str
  as_fg_str(self: AnsiColor): string {
    switch (self) {
      case "Black":
        return "\x1B[30m"; // escape!("3", "0")
      case "Red":
        return "\x1B[31m"; // escape!("3", "1")
      case "Green":
        return "\x1B[32m"; // escape!("3", "2")
      case "Yellow":
        return "\x1B[33m"; // escape!("3", "3")
      case "Blue":
        return "\x1B[34m"; // escape!("3", "4")
      case "Magenta":
        return "\x1B[35m"; // escape!("3", "5")
      case "Cyan":
        return "\x1B[36m"; // escape!("3", "6")
      case "White":
        return "\x1B[37m"; // escape!("3", "7")
      case "BrightBlack":
        return "\x1B[90m"; // escape!("9", "0")
      case "BrightRed":
        return "\x1B[91m"; // escape!("9", "1")
      case "BrightGreen":
        return "\x1B[92m"; // escape!("9", "2")
      case "BrightYellow":
        return "\x1B[93m"; // escape!("9", "3")
      case "BrightBlue":
        return "\x1B[94m"; // escape!("9", "4")
      case "BrightMagenta":
        return "\x1B[95m"; // escape!("9", "5")
      case "BrightCyan":
        return "\x1B[96m"; // escape!("9", "6")
      case "BrightWhite":
        return "\x1B[97m"; // escape!("9", "7")
    }
  },

  // crate: anstyle-1.0.13/src/color.rs:232 as_fg_buffer
  as_fg_buffer(self: AnsiColor): DisplayBuffer {
    return DisplayBuffer.default().write_str(AnsiColor.as_fg_str(self));
  },

  /// Render the ANSI code for a background color
  // crate: anstyle-1.0.13/src/color.rs:238 render_bg
  render_bg(self: AnsiColor): string {
    return new NullFormatter(AnsiColor.as_bg_str(self)).fmt(PLAIN);
  },

  // crate: anstyle-1.0.13/src/color.rs:243 as_bg_str
  as_bg_str(self: AnsiColor): string {
    switch (self) {
      case "Black":
        return "\x1B[40m"; // escape!("4", "0")
      case "Red":
        return "\x1B[41m"; // escape!("4", "1")
      case "Green":
        return "\x1B[42m"; // escape!("4", "2")
      case "Yellow":
        return "\x1B[43m"; // escape!("4", "3")
      case "Blue":
        return "\x1B[44m"; // escape!("4", "4")
      case "Magenta":
        return "\x1B[45m"; // escape!("4", "5")
      case "Cyan":
        return "\x1B[46m"; // escape!("4", "6")
      case "White":
        return "\x1B[47m"; // escape!("4", "7")
      case "BrightBlack":
        return "\x1B[100m"; // escape!("10", "0")
      case "BrightRed":
        return "\x1B[101m"; // escape!("10", "1")
      case "BrightGreen":
        return "\x1B[102m"; // escape!("10", "2")
      case "BrightYellow":
        return "\x1B[103m"; // escape!("10", "3")
      case "BrightBlue":
        return "\x1B[104m"; // escape!("10", "4")
      case "BrightMagenta":
        return "\x1B[105m"; // escape!("10", "5")
      case "BrightCyan":
        return "\x1B[106m"; // escape!("10", "6")
      case "BrightWhite":
        return "\x1B[107m"; // escape!("10", "7")
    }
  },

  // crate: anstyle-1.0.13/src/color.rs:265 as_bg_buffer
  as_bg_buffer(self: AnsiColor): DisplayBuffer {
    return DisplayBuffer.default().write_str(AnsiColor.as_bg_str(self));
  },

  // crate: anstyle-1.0.13/src/color.rs:270 as_underline_buffer
  as_underline_buffer(self: AnsiColor): DisplayBuffer {
    // No per-color codes; must delegate to `Ansi256Color`
    return Ansi256Color.from_AnsiColor(self).as_underline_buffer();
  },

  /// Change the color to/from bright
  // crate: anstyle-1.0.13/src/color.rs:278 bright
  bright(self: AnsiColor, yes: boolean): AnsiColor {
    if (yes) {
      switch (self) {
        case "Black":
          return "BrightBlack";
        case "Red":
          return "BrightRed";
        case "Green":
          return "BrightGreen";
        case "Yellow":
          return "BrightYellow";
        case "Blue":
          return "BrightBlue";
        case "Magenta":
          return "BrightMagenta";
        case "Cyan":
          return "BrightCyan";
        case "White":
          return "BrightWhite";
        case "BrightBlack":
          return self;
        case "BrightRed":
          return self;
        case "BrightGreen":
          return self;
        case "BrightYellow":
          return self;
        case "BrightBlue":
          return self;
        case "BrightMagenta":
          return self;
        case "BrightCyan":
          return self;
        case "BrightWhite":
          return self;
      }
    } else {
      switch (self) {
        case "Black":
          return self;
        case "Red":
          return self;
        case "Green":
          return self;
        case "Yellow":
          return self;
        case "Blue":
          return self;
        case "Magenta":
          return self;
        case "Cyan":
          return self;
        case "White":
          return self;
        case "BrightBlack":
          return "Black";
        case "BrightRed":
          return "Red";
        case "BrightGreen":
          return "Green";
        case "BrightYellow":
          return "Yellow";
        case "BrightBlue":
          return "Blue";
        case "BrightMagenta":
          return "Magenta";
        case "BrightCyan":
          return "Cyan";
        case "BrightWhite":
          return "White";
      }
    }
  },

  /// Report whether the color is bright
  // crate: anstyle-1.0.13/src/color.rs:322 is_bright
  is_bright(self: AnsiColor): boolean {
    switch (self) {
      case "Black":
        return false;
      case "Red":
        return false;
      case "Green":
        return false;
      case "Yellow":
        return false;
      case "Blue":
        return false;
      case "Magenta":
        return false;
      case "Cyan":
        return false;
      case "White":
        return false;
      case "BrightBlack":
        return true;
      case "BrightRed":
        return true;
      case "BrightGreen":
        return true;
      case "BrightYellow":
        return true;
      case "BrightBlue":
        return true;
      case "BrightMagenta":
        return true;
      case "BrightCyan":
        return true;
      case "BrightWhite":
        return true;
    }
  },
} as const;

export const debug_AnsiColor: Debug<AnsiColor> = (v) => v;

/// 256 (8-bit) color support
///
/// - `0..16` are [`AnsiColor`] palette codes
/// - `0..232` map to [`RgbColor`] color values
/// - `232..` map to [`RgbColor`] gray-scale values
export class Ansi256Color {
  constructor(readonly _0: number) {}

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:357 on
  on(background: Color): Style {
    return Style.bg_color(Style.fg_color(Style.new(), Color.from_Ansi256Color(this)), background);
  }

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:365 on_default
  on_default(): Style {
    return Style.fg_color(Style.new(), { $: "Ansi256", _0: this });
  }

  /// Get the raw value
  // crate: anstyle-1.0.13/src/color.rs:371 index
  index(): number {
    return this._0;
  }

  /// Convert to [`AnsiColor`] when there is a 1:1 mapping
  // crate: anstyle-1.0.13/src/color.rs:377 into_ansi
  into_ansi(): AnsiColor | undefined {
    switch (this.index()) {
      case 0:
        return "Black";
      case 1:
        return "Red";
      case 2:
        return "Green";
      case 3:
        return "Yellow";
      case 4:
        return "Blue";
      case 5:
        return "Magenta";
      case 6:
        return "Cyan";
      case 7:
        return "White";
      case 8:
        return "BrightBlack";
      case 9:
        return "BrightRed";
      case 10:
        return "BrightGreen";
      case 11:
        return "BrightYellow";
      case 12:
        return "BrightBlue";
      case 13:
        return "BrightMagenta";
      case 14:
        return "BrightCyan";
      case 15:
        return "BrightWhite";
      default:
        return undefined;
    }
  }

  /// Losslessly convert from [`AnsiColor`]
  // crate: anstyle-1.0.13/src/color.rs:401 from_ansi
  static from_ansi(color: AnsiColor): Ansi256Color {
    switch (color) {
      case "Black":
        return new Ansi256Color(0);
      case "Red":
        return new Ansi256Color(1);
      case "Green":
        return new Ansi256Color(2);
      case "Yellow":
        return new Ansi256Color(3);
      case "Blue":
        return new Ansi256Color(4);
      case "Magenta":
        return new Ansi256Color(5);
      case "Cyan":
        return new Ansi256Color(6);
      case "White":
        return new Ansi256Color(7);
      case "BrightBlack":
        return new Ansi256Color(8);
      case "BrightRed":
        return new Ansi256Color(9);
      case "BrightGreen":
        return new Ansi256Color(10);
      case "BrightYellow":
        return new Ansi256Color(11);
      case "BrightBlue":
        return new Ansi256Color(12);
      case "BrightMagenta":
        return new Ansi256Color(13);
      case "BrightCyan":
        return new Ansi256Color(14);
      case "BrightWhite":
        return new Ansi256Color(15);
    }
  }

  /// Render the ANSI code for a foreground color
  // crate: anstyle-1.0.13/src/color.rs:424 render_fg
  render_fg(): string {
    return this.as_fg_buffer().fmt(PLAIN);
  }

  // crate: anstyle-1.0.13/src/color.rs:429 as_fg_buffer
  as_fg_buffer(): DisplayBuffer {
    return DisplayBuffer.default().write_str("\x1B[38;5;").write_code(this.index()).write_str("m");
  }

  /// Render the ANSI code for a background color
  // crate: anstyle-1.0.13/src/color.rs:438 render_bg
  render_bg(): string {
    return this.as_bg_buffer().fmt(PLAIN);
  }

  // crate: anstyle-1.0.13/src/color.rs:443 as_bg_buffer
  as_bg_buffer(): DisplayBuffer {
    return DisplayBuffer.default().write_str("\x1B[48;5;").write_code(this.index()).write_str("m");
  }

  // crate: anstyle-1.0.13/src/color.rs:451 as_underline_buffer
  as_underline_buffer(): DisplayBuffer {
    return DisplayBuffer.default().write_str("\x1B[58;5;").write_code(this.index()).write_str("m");
  }

  // impl From<u8> for Ansi256Color
  // crate: anstyle-1.0.13/src/color.rs:461 from
  static from_u8(inner: number): Ansi256Color {
    return new Ansi256Color(inner);
  }

  // impl From<AnsiColor> for Ansi256Color
  // crate: anstyle-1.0.13/src/color.rs:468 from
  static from_AnsiColor(inner: AnsiColor): Ansi256Color {
    return Ansi256Color.from_ansi(inner);
  }
}

export const debug_Ansi256Color: Debug<Ansi256Color> = (v, f) => debug_tuple(f, "Ansi256Color", [String(v._0)]);

/// 24-bit ANSI RGB color codes
export class RgbColor {
  constructor(
    readonly _0: number,
    readonly _1: number,
    readonly _2: number,
  ) {}

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:481 on
  on(background: Color): Style {
    return Style.bg_color(Style.fg_color(Style.new(), Color.from_RgbColor(this)), background);
  }

  /// Create a [`Style`][crate::Style] with this as the foreground
  // crate: anstyle-1.0.13/src/color.rs:489 on_default
  on_default(): Style {
    return Style.fg_color(Style.new(), { $: "Rgb", _0: this });
  }

  /// Red
  // crate: anstyle-1.0.13/src/color.rs:495 r
  r(): number {
    return this._0;
  }

  /// Green
  // crate: anstyle-1.0.13/src/color.rs:501 g
  g(): number {
    return this._1;
  }

  /// Blue
  // crate: anstyle-1.0.13/src/color.rs:507 b
  b(): number {
    return this._2;
  }

  /// Render the ANSI code for a foreground color
  // crate: anstyle-1.0.13/src/color.rs:513 render_fg
  render_fg(): string {
    return this.as_fg_buffer().fmt(PLAIN);
  }

  // crate: anstyle-1.0.13/src/color.rs:518 as_fg_buffer
  as_fg_buffer(): DisplayBuffer {
    return DisplayBuffer.default()
      .write_str("\x1B[38;2;")
      .write_code(this.r())
      .write_str(";")
      .write_code(this.g())
      .write_str(";")
      .write_code(this.b())
      .write_str("m");
  }

  /// Render the ANSI code for a background color
  // crate: anstyle-1.0.13/src/color.rs:531 render_bg
  render_bg(): string {
    return this.as_bg_buffer().fmt(PLAIN);
  }

  // crate: anstyle-1.0.13/src/color.rs:536 as_bg_buffer
  as_bg_buffer(): DisplayBuffer {
    return DisplayBuffer.default()
      .write_str("\x1B[48;2;")
      .write_code(this.r())
      .write_str(";")
      .write_code(this.g())
      .write_str(";")
      .write_code(this.b())
      .write_str("m");
  }

  // crate: anstyle-1.0.13/src/color.rs:548 as_underline_buffer
  as_underline_buffer(): DisplayBuffer {
    return DisplayBuffer.default()
      .write_str("\x1B[58;2;")
      .write_code(this.r())
      .write_str(";")
      .write_code(this.g())
      .write_str(";")
      .write_code(this.b())
      .write_str("m");
  }

  // impl From<(u8, u8, u8)> for RgbColor
  // crate: anstyle-1.0.13/src/color.rs:562 from
  static from_tuple(inner: readonly [number, number, number]): RgbColor {
    const [r, g, b] = inner;
    return new RgbColor(r, g, b);
  }
}

export const debug_RgbColor: Debug<RgbColor> = (v, f) => debug_tuple(f, "RgbColor", [String(v._0), String(v._1), String(v._2)]);

export const DISPLAY_BUFFER_CAPACITY = 19;

// PORT: `Copy` struct whose `mut self` builder methods are only ever called on a fresh
// `DisplayBuffer::default()`, so they update `this` in place and return it.
export class DisplayBuffer {
  constructor(
    public buffer: Uint8Array,
    public len: number,
  ) {}

  /** `#[derive(Default)]` */
  static default(): DisplayBuffer {
    return new DisplayBuffer(new Uint8Array(DISPLAY_BUFFER_CAPACITY), 0);
  }

  // crate: anstyle-1.0.13/src/color.rs:579 write_str
  write_str(part: string): DisplayBuffer {
    const bytes = utf8(part);
    for (let i = 0; i < bytes.length; i++) {
      this.set(this.len + i, bytes[i]!);
    }
    this.len += bytes.length;
    return this;
  }

  // crate: anstyle-1.0.13/src/color.rs:589 write_code
  write_code(code: number): DisplayBuffer {
    const c1 = Math.floor(code / 100) % 10;
    const c2 = Math.floor(code / 10) % 10;
    const c3 = code % 10;

    let printed = false;
    if (c1 !== 0) {
      printed = true;
      this.set(this.len, 0x30 /* b'0' */ + c1);
      this.len += 1;
    }
    if (c2 !== 0 || printed) {
      this.set(this.len, 0x30 /* b'0' */ + c2);
      this.len += 1;
    }
    // If we received a zero value we must still print a value.
    this.set(this.len, 0x30 /* b'0' */ + c3);
    this.len += 1;

    return this;
  }

  /** `self.buffer[i] = b` with the array bounds check. */
  private set(i: number, b: number): void {
    if (i >= DISPLAY_BUFFER_CAPACITY) panic(`index out of bounds: the len is ${DISPLAY_BUFFER_CAPACITY} but the index is ${i}`);
    this.buffer[i] = b;
  }

  // crate: anstyle-1.0.13/src/color.rs:612 as_str
  as_str(): string {
    // PORT: only ASCII is ever written (escape codes and digits).
    return String.fromCharCode(...this.buffer.subarray(0, this.len));
  }

  // crate: anstyle-1.0.13/src/color.rs:622 write_to
  write_to(write: Write): Result<undefined, unknown> {
    return write.write_all(utf8(this.as_str()));
  }

  // impl core::fmt::Display for DisplayBuffer
  // crate: anstyle-1.0.13/src/color.rs:629 fmt
  fmt(_f: Fmt): string {
    return this.as_str();
  }
}

export const debug_DisplayBuffer: Debug<DisplayBuffer> = (v, f) =>
  debug_struct(f, "DisplayBuffer", [
    ["buffer", debug_list(f, Array.from(v.buffer, (b) => String(b)))],
    ["len", String(v.len)],
  ]);

export class NullFormatter {
  constructor(readonly _0: string) {}

  // impl core::fmt::Display for NullFormatter
  // crate: anstyle-1.0.13/src/color.rs:639 fmt
  fmt(_f: Fmt): string {
    return this._0;
  }
}

export const debug_NullFormatter: Debug<NullFormatter> = (v, f) => debug_tuple(f, "NullFormatter", [debug_str(v._0)]);
