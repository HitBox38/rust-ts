// Port of anstyle =1.0.13 `src/style.rs`.
//
// PORT: `Style` has methods named like its fields (`effects`, `underline`), which a TS class
// cannot express, so it is a readonly interface plus a same-named companion const whose methods
// take `self` first. `Style` is `Copy`: the `mut self` builders return a fresh object and never
// modify their argument.

import { debug_option, debug_struct, debug_tuple, type Debug, type Fmt } from "../../std/fmt.ts";
import { Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { Color, Color_eq, debug_Color } from "./color.ts";
import { debug_Effects, Effects } from "./effect.ts";
import type { Write } from "./lib.ts";
import { RESET } from "./reset.ts";

/// ANSI Text styling
///
/// You can print a `Style` to render the corresponding ANSI code.
/// Using the alternate flag `#` will render the ANSI reset code, if needed.
/// Together, this makes it convenient to render styles using inline format arguments.
///
/// # Examples
///
/// ```rust
/// let style = anstyle::Style::new().bold();
///
/// let value = 42;
/// println!("{style}{value}{style:#}");
/// ```
export interface Style {
  readonly fg: Color | undefined;
  readonly bg: Color | undefined;
  readonly underline: Color | undefined;
  readonly effects: Effects;
}

const PLAIN: Fmt = { alternate: false };

export const Style = {
  // # Core

  /// No effects enabled
  // crate: anstyle-1.0.13/src/style.rs:35 new
  new(): Style {
    return {
      fg: undefined,
      bg: undefined,
      underline: undefined,
      effects: Effects.new(),
    };
  },

  /// Set foreground color
  // crate: anstyle-1.0.13/src/style.rs:53 fg_color
  fg_color(self: Style, fg: Color | undefined): Style {
    return { ...self, fg };
  },

  /// Set background color
  // crate: anstyle-1.0.13/src/style.rs:67 bg_color
  bg_color(self: Style, bg: Color | undefined): Style {
    return { ...self, bg };
  },

  /// Set underline color
  // crate: anstyle-1.0.13/src/style.rs:81 underline_color
  underline_color(self: Style, underline: Color | undefined): Style {
    return { ...self, underline };
  },

  /// Set text effects
  // crate: anstyle-1.0.13/src/style.rs:95 effects
  effects(self: Style, effects: Effects): Style {
    return { ...self, effects };
  },

  /// Render the ANSI code
  ///
  /// `Style` also implements `Display` directly, so calling this method is optional.
  // crate: anstyle-1.0.13/src/style.rs:104 render
  render(self: Style): string {
    return new StyleDisplay(self).fmt(PLAIN);
  },

  // crate: anstyle-1.0.13/src/style.rs:108 fmt_to
  fmt_to(self: Style, _f: Fmt): string {
    let f = "";
    f += Effects.render(self.effects);

    if (self.fg !== undefined) {
      f += Color.render_fg(self.fg);
    }

    if (self.bg !== undefined) {
      f += Color.render_bg(self.bg);
    }

    if (self.underline !== undefined) {
      f += Color.render_underline(self.underline);
    }

    return f;
  },

  /// Write the ANSI code
  // crate: anstyle-1.0.13/src/style.rs:131 write_to
  write_to(self: Style, write: Write): Result<undefined, unknown> {
    let r = Effects.write_to(self.effects, write);
    if (r.$ === "Err") return r;

    if (self.fg !== undefined) {
      r = Color.write_fg_to(self.fg, write);
      if (r.$ === "Err") return r;
    }

    if (self.bg !== undefined) {
      r = Color.write_bg_to(self.bg, write);
      if (r.$ === "Err") return r;
    }

    if (self.underline !== undefined) {
      r = Color.write_underline_to(self.underline, write);
      if (r.$ === "Err") return r;
    }

    return Ok(undefined);
  },

  /// Renders the relevant [`Reset`][crate::Reset] code
  ///
  /// Unlike [`Reset::render`][crate::Reset::render], this will elide the code if there is nothing to reset.
  // crate: anstyle-1.0.13/src/style.rs:153 render_reset
  render_reset(self: Style): string {
    if (!Style_eq(self, Style.new())) {
      return RESET;
    } else {
      return "";
    }
  },

  /// Write the relevant [`Reset`][crate::Reset] code
  ///
  /// Unlike [`Reset::render`][crate::Reset::render], this will elide the code if there is nothing to reset.
  // crate: anstyle-1.0.13/src/style.rs:166 write_reset_to
  write_reset_to(self: Style, write: Write): Result<undefined, unknown> {
    if (!Style_eq(self, Style.new())) {
      return write.write_all(utf8(RESET));
    } else {
      return Ok(undefined);
    }
  },

  // # Convenience

  /// Apply `bold` effect
  // crate: anstyle-1.0.13/src/style.rs:186 bold
  bold(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.BOLD) };
  },

  /// Apply `dimmed` effect
  // crate: anstyle-1.0.13/src/style.rs:200 dimmed
  dimmed(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.DIMMED) };
  },

  /// Apply `italic` effect
  // crate: anstyle-1.0.13/src/style.rs:214 italic
  italic(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.ITALIC) };
  },

  /// Apply `underline` effect
  // crate: anstyle-1.0.13/src/style.rs:228 underline
  underline(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.UNDERLINE) };
  },

  /// Apply `blink` effect
  // crate: anstyle-1.0.13/src/style.rs:242 blink
  blink(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.BLINK) };
  },

  /// Apply `invert` effect
  // crate: anstyle-1.0.13/src/style.rs:256 invert
  invert(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.INVERT) };
  },

  /// Apply `hidden` effect
  // crate: anstyle-1.0.13/src/style.rs:270 hidden
  hidden(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.HIDDEN) };
  },

  /// Apply `strikethrough` effect
  // crate: anstyle-1.0.13/src/style.rs:284 strikethrough
  strikethrough(self: Style): Style {
    return { ...self, effects: Effects.insert(self.effects, Effects.STRIKETHROUGH) };
  },

  // # Reflection

  /// Get the foreground color
  // crate: anstyle-1.0.13/src/style.rs:294 get_fg_color
  get_fg_color(self: Style): Color | undefined {
    return self.fg;
  },

  /// Get the background color
  // crate: anstyle-1.0.13/src/style.rs:301 get_bg_color
  get_bg_color(self: Style): Color | undefined {
    return self.bg;
  },

  // crate: anstyle-1.0.13/src/style.rs:307 get_underline_color
  get_underline_color(self: Style): Color | undefined {
    return self.underline;
  },

  // crate: anstyle-1.0.13/src/style.rs:313 get_effects
  get_effects(self: Style): Effects {
    return self.effects;
  },

  /// Check if no styling is enabled
  // crate: anstyle-1.0.13/src/style.rs:319 is_plain
  is_plain(self: Style): boolean {
    return self.fg === undefined && self.bg === undefined && self.underline === undefined && Effects.is_plain(self.effects);
  },

  // impl From<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:334 from
  from_Effects(effects: Effects): Style {
    return Style.effects(Style.new(), effects);
  },

  // impl core::ops::BitOr<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:348 bitor
  bitor(self: Style, rhs: Effects): Style {
    return { ...self, effects: Effects.insert(self.effects, rhs) };
  },

  // impl core::ops::BitOrAssign<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:362 bitor_assign
  bitor_assign(self: { value: Style }, other: Effects): void {
    self.value = { ...self.value, effects: Effects.insert(self.value.effects, other) };
  },

  // impl core::ops::Sub<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:376 sub
  sub(self: Style, other: Effects): Style {
    return { ...self, effects: Effects.remove(self.effects, other) };
  },

  // impl core::ops::SubAssign<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:390 sub_assign
  sub_assign(self: { value: Style }, other: Effects): void {
    self.value = { ...self.value, effects: Effects.remove(self.value.effects, other) };
  },

  // impl PartialEq<crate::Effects> for Style
  // crate: anstyle-1.0.13/src/style.rs:405 eq
  eq_Effects(self: Style, other: Effects): boolean {
    const other_ = Style.from_Effects(other);
    return Style_eq(self, other_);
  },

  // impl core::fmt::Display for Style
  // crate: anstyle-1.0.13/src/style.rs:413 fmt
  fmt(self: Style, f: Fmt): string {
    if (f.alternate) {
      return Style.render_reset(self);
    } else {
      return Style.fmt_to(self, f);
    }
  },
} as const;

/** `#[derive(Default)]` (same as `Style::new()`). */
export function Style_default(): Style {
  return Style.new();
}

/** `#[derive(PartialEq)] for Style` */
export function Style_eq(a: Style, b: Style): boolean {
  return option_color_eq(a.fg, b.fg) && option_color_eq(a.bg, b.bg) && option_color_eq(a.underline, b.underline) && a.effects === b.effects;
}

function option_color_eq(a: Color | undefined, b: Color | undefined): boolean {
  return a === undefined || b === undefined ? a === b : Color_eq(a, b);
}

export const debug_Style: Debug<Style> = (v, f) =>
  debug_struct(f, "Style", [
    ["fg", debug_option(v.fg, f, debug_Color)],
    ["bg", debug_option(v.bg, f, debug_Color)],
    ["underline", debug_option(v.underline, f, debug_Color)],
    ["effects", debug_Effects(v.effects, f)],
  ]);

export class StyleDisplay {
  constructor(readonly _0: Style) {}

  // impl core::fmt::Display for StyleDisplay
  // crate: anstyle-1.0.13/src/style.rs:426 fmt
  fmt(f: Fmt): string {
    return Style.fmt_to(this._0, f);
  }
}

export const debug_StyleDisplay: Debug<StyleDisplay> = (v, f) => debug_tuple(f, "StyleDisplay", [debug_Style(v._0, f)]);
