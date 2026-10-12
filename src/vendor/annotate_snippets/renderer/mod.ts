// Port of annotate-snippets =0.12.16 `src/renderer/mod.rs`.
//
//! The [Renderer] and its settings
//!
//! # Example
//!
//! ```
//! # use annotate_snippets::*;
//! # use annotate_snippets::renderer::*;
//! # use annotate_snippets::Level;
//! let report = // ...
//! # &[Group::with_title(
//! #     Level::ERROR
//! #         .primary_title("unresolved import `baz::zed`")
//! #         .id("E0432")
//! # )];
//!
//! let renderer = Renderer::styled().decor_style(DecorStyle::Unicode);
//! let output = renderer.render(report);
//! anstream::println!("{output}");
//! ```
//
// PORT: `Renderer` has builder methods named like its fields (`term_width`, `decor_style`,
// `short_message`, `anonymized_line_numbers`), so it is an interface plus a same-named companion
// const whose methods take `self` first; the `mut self` builders update `self` in place and
// return it. `self.stylesheet.x = style` builds a new `Stylesheet` (it is `Copy`).

import { AnsiColor } from "../../anstyle/color.ts";
import { Effects } from "../../anstyle/effect.ts";
import { Style } from "../../anstyle/style.ts";
import { ch } from "../../../std/char.ts";
import { debug_bool, debug_struct, type Debug } from "../../../std/fmt.ts";
import type { Report } from "../snippet.ts";
import * as render_ from "./render.ts";
import { ElementStyle, type UnderlineParts } from "./render.ts";
import { debug_Stylesheet, Stylesheet } from "./stylesheet.ts";

export { ElementStyle, LineAnnotation, LineAnnotationType, char_width, normalize_whitespace, num_overlap } from "./render.ts";
export type { UnderlineParts } from "./render.ts";
export { Stylesheet } from "./stylesheet.ts";

export * from "../../anstyle/lib.ts";

/// See [`Renderer::term_width`]
export const DEFAULT_TERM_WIDTH = 140;

// PORT: `cfg!(windows)` is the target of the rustc build. rust-ts runs on the oracle's host, so it
// is read from the host platform. The `testing-colors` feature is not enabled by rustc.
const FEATURE_TESTING_COLORS = false; // cfg!(feature = "testing-colors")
const USE_WINDOWS_COLORS: boolean = process.platform === "win32" && !FEATURE_TESTING_COLORS;
const BRIGHT_BLUE: Style = USE_WINDOWS_COLORS ? AnsiColor.on_default(AnsiColor.BrightCyan) : AnsiColor.on_default(AnsiColor.BrightBlue);
/// [`Renderer::error`] applied by [`Renderer::styled`]
export const DEFAULT_ERROR_STYLE: Style = Style.effects(AnsiColor.on_default(AnsiColor.BrightRed), Effects.BOLD);
/// [`Renderer::warning`] applied by [`Renderer::styled`]
export const DEFAULT_WARNING_STYLE: Style = Style.effects(
  USE_WINDOWS_COLORS ? AnsiColor.on_default(AnsiColor.BrightYellow) : AnsiColor.on_default(AnsiColor.Yellow),
  Effects.BOLD,
);
/// [`Renderer::info`] applied by [`Renderer::styled`]
export const DEFAULT_INFO_STYLE: Style = Style.effects(BRIGHT_BLUE, Effects.BOLD);
/// [`Renderer::note`] applied by [`Renderer::styled`]
export const DEFAULT_NOTE_STYLE: Style = Style.effects(AnsiColor.on_default(AnsiColor.BrightGreen), Effects.BOLD);
/// [`Renderer::help`] applied by [`Renderer::styled`]
export const DEFAULT_HELP_STYLE: Style = Style.effects(AnsiColor.on_default(AnsiColor.BrightCyan), Effects.BOLD);
/// [`Renderer::line_num`] applied by [`Renderer::styled`]
export const DEFAULT_LINE_NUM_STYLE: Style = Style.effects(BRIGHT_BLUE, Effects.BOLD);
/// [`Renderer::emphasis`] applied by [`Renderer::styled`]
export const DEFAULT_EMPHASIS_STYLE: Style = Style.effects(USE_WINDOWS_COLORS ? AnsiColor.on_default(AnsiColor.BrightWhite) : Style.new(), Effects.BOLD);
/// [`Renderer::none`] applied by [`Renderer::styled`]
export const DEFAULT_NONE_STYLE: Style = Style.new();
/// [`Renderer::context`] applied by [`Renderer::styled`]
export const DEFAULT_CONTEXT_STYLE: Style = Style.effects(BRIGHT_BLUE, Effects.BOLD);
/// [`Renderer::addition`] applied by [`Renderer::styled`]
export const DEFAULT_ADDITION_STYLE: Style = AnsiColor.on_default(AnsiColor.BrightGreen);
/// [`Renderer::removal`] applied by [`Renderer::styled`]
export const DEFAULT_REMOVAL_STYLE: Style = AnsiColor.on_default(AnsiColor.BrightRed);

/// The [Renderer] for a [`Report`]
///
/// The caller is expected to detect any relevant terminal features and configure the renderer,
/// including
/// - ANSI Escape code support (always outputted with [`Renderer::styled`])
/// - Terminal width ([`Renderer::term_width`])
/// - Unicode support ([`Renderer::decor_style`])
export interface Renderer {
  anonymized_line_numbers: boolean;
  term_width: number;
  decor_style: DecorStyle;
  stylesheet: Stylesheet;
  short_message: boolean;
}

export const Renderer = {
  /// No terminal styling
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:118 plain
  plain(): Renderer {
    return {
      anonymized_line_numbers: false,
      term_width: DEFAULT_TERM_WIDTH,
      decor_style: "Ascii",
      stylesheet: Stylesheet.plain(),
      short_message: false,
    };
  },

  /// Default terminal styling
  ///
  /// If ANSI escape codes are not supported, either
  /// - Call [`Renderer::plain`] instead
  /// - Strip them after the fact, like with [`anstream`](https://docs.rs/anstream/latest/anstream/)
  ///
  /// # Note
  ///
  /// When testing styled terminal output, see the [`testing-colors` feature](crate#features)
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:137 styled
  styled(): Renderer {
    return {
      ...Renderer.plain(),
      stylesheet: {
        error: DEFAULT_ERROR_STYLE,
        warning: DEFAULT_WARNING_STYLE,
        info: DEFAULT_INFO_STYLE,
        note: DEFAULT_NOTE_STYLE,
        help: DEFAULT_HELP_STYLE,
        line_num: DEFAULT_LINE_NUM_STYLE,
        emphasis: DEFAULT_EMPHASIS_STYLE,
        none: DEFAULT_NONE_STYLE,
        context: DEFAULT_CONTEXT_STYLE,
        addition: DEFAULT_ADDITION_STYLE,
        removal: DEFAULT_REMOVAL_STYLE,
      },
    };
  },

  /// Abbreviate the message
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:157 short_message
  short_message(self: Renderer, short_message: boolean): Renderer {
    self.short_message = short_message;
    return self;
  },

  /// Set the width to render within
  ///
  /// Affects the rendering of [`Snippet`][crate::Snippet]s
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:165 term_width
  term_width(self: Renderer, term_width: number): Renderer {
    self.term_width = term_width;
    return self;
  },

  /// Set the character set used for rendering decor
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:171 decor_style
  decor_style(self: Renderer, decor_style: DecorStyle): Renderer {
    self.decor_style = decor_style;
    return self;
  },

  /// Anonymize line numbers
  ///
  /// When enabled, line numbers are replaced with `LL` which is useful for tests.
  ///
  /// # Example
  ///
  /// ```text
  ///   --> $DIR/whitespace-trimming.rs:4:193
  ///    |
  /// LL | ...                   let _: () = 42;
  ///    |                                   ^^ expected (), found integer
  ///    |
  /// ```
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:189 anonymized_line_numbers
  anonymized_line_numbers(self: Renderer, anonymized_line_numbers: boolean): Renderer {
    self.anonymized_line_numbers = anonymized_line_numbers;
    return self;
  },

  /// Render a diagnostic [`Report`]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:197 render
  render(self: Renderer, groups: Report): string {
    return render_.render(self, groups);
  },

  // Customize [`Renderer::styled`]

  /// Override the output style for [error][crate::Level::ERROR]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:205 error
  error(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, error: style };
    return self;
  },

  /// Override the output style for [warnings][crate::Level::WARNING]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:211 warning
  warning(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, warning: style };
    return self;
  },

  /// Override the output style for [info][crate::Level::INFO]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:217 info
  info(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, info: style };
    return self;
  },

  /// Override the output style for [notes][crate::Level::NOTE]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:223 note
  note(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, note: style };
    return self;
  },

  /// Override the output style for [help][crate::Level::HELP]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:229 help
  help(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, help: style };
    return self;
  },

  /// Override the output style for line numbers in the [`Snippet`][crate::Snippet] gutter
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:235 line_num
  line_num(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, line_num: style };
    return self;
  },

  /// Override the output style for emphasis for the
  /// [`primary_title`][crate::Level::primary_title]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:242 emphasis
  emphasis(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, emphasis: style };
    return self;
  },

  /// Override the output style for [`AnnotationKind::Context`][crate::AnnotationKind::Context]
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:248 context
  context(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, context: style };
    return self;
  },

  /// Override the output style for [`Patch`][crate::Patch] additions
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:254 addition
  addition(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, addition: style };
    return self;
  },

  /// Override the output style for [`Patch`][crate::Patch] removals
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:260 removal
  removal(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, removal: style };
    return self;
  },

  /// Override the output style for all other text
  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:266 none
  none(self: Renderer, style: Style): Renderer {
    self.stylesheet = { ...self.stylesheet, none: style };
    return self;
  },
} as const;

export const debug_Renderer: Debug<Renderer> = (v, f) =>
  debug_struct(f, "Renderer", [
    ["anonymized_line_numbers", debug_bool(v.anonymized_line_numbers, f)],
    ["term_width", String(v.term_width)],
    ["decor_style", debug_DecorStyle(v.decor_style, f)],
    ["stylesheet", debug_Stylesheet(v.stylesheet, f)],
    ["short_message", debug_bool(v.short_message, f)],
  ]);

/// The character set for rendering for decor
export type DecorStyle = "Ascii" | "Unicode";

export const DecorStyle = {
  Ascii: "Ascii",
  Unicode: "Unicode",

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:280 col_separator
  col_separator(self: DecorStyle): number {
    switch (self) {
      case "Ascii":
        return ch("|");
      case "Unicode":
        return ch("│");
    }
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:287 note_separator
  note_separator(self: DecorStyle, is_cont: boolean): string {
    if (self === "Ascii") return "= ";
    if (self === "Unicode" && is_cont) return "├ ";
    return "╰ "; // DecorStyle::Unicode
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:295 multi_suggestion_separator
  multi_suggestion_separator(self: DecorStyle): string {
    switch (self) {
      case "Ascii":
        return "|";
      case "Unicode":
        return "├╴";
    }
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:302 file_start
  file_start(self: DecorStyle, is_first: boolean, alone: boolean): string {
    if (self === "Ascii") return "--> ";
    if (self === "Unicode" && is_first && alone) return " ─▸ ";
    if (self === "Unicode" && is_first) return " ╭▸ ";
    return " ├▸ "; // DecorStyle::Unicode
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:311 secondary_file_start
  secondary_file_start(self: DecorStyle): string {
    switch (self) {
      case "Ascii":
        return "::: ";
      case "Unicode":
        return " ⸬  ";
    }
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:318 diff
  diff(self: DecorStyle): number {
    switch (self) {
      case "Ascii":
        return ch("~");
      case "Unicode":
        return ch("±");
    }
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:325 margin
  margin(self: DecorStyle): string {
    switch (self) {
      case "Ascii":
        return "...";
      case "Unicode":
        return "…";
    }
  },

  // crate: annotate-snippets-0.12.16/src/renderer/mod.rs:332 underline
  underline(self: DecorStyle, is_primary: boolean): UnderlineParts {
    //               X0 Y0
    // label_start > ┯━━━━ < underline
    //               │ < vertical_text_line
    //               text

    //    multiline_start_down ⤷ X0 Y0
    //            top_left > ┌───╿──┘ < top_right_flat
    //           top_left > ┏│━━━┙ < top_right
    // multiline_vertical > ┃│
    //                      ┃│   X1 Y1
    //                      ┃│   X2 Y2
    //                      ┃└────╿──┘ < multiline_end_same_line
    //        bottom_left > ┗━━━━━┥ < bottom_right_with_text
    //   multiline_horizontal ^   `X` is a good letter

    // multiline_whole_line > ┏ X0 Y0
    //                        ┃   X1 Y1
    //                        ┗━━━━┛ < multiline_end_same_line

    // multiline_whole_line > ┏ X0 Y0
    //                        ┃ X1 Y1
    //                        ┃  ╿ < multiline_end_up
    //                        ┗━━┛ < bottom_right

    if (self === "Ascii" && is_primary) {
      return {
        style: ElementStyle.UnderlinePrimary,
        underline: ch("^"),
        label_start: ch("^"),
        vertical_text_line: ch("|"),
        multiline_vertical: ch("|"),
        multiline_horizontal: ch("_"),
        multiline_whole_line: ch("/"),
        multiline_start_down: ch("^"),
        bottom_right: ch("|"),
        top_left: ch(" "),
        top_right_flat: ch("^"),
        bottom_left: ch("|"),
        multiline_end_up: ch("^"),
        multiline_end_same_line: ch("^"),
        multiline_bottom_right_with_text: ch("|"),
      };
    } else if (self === "Ascii" && !is_primary) {
      return {
        style: ElementStyle.UnderlineSecondary,
        underline: ch("-"),
        label_start: ch("-"),
        vertical_text_line: ch("|"),
        multiline_vertical: ch("|"),
        multiline_horizontal: ch("_"),
        multiline_whole_line: ch("/"),
        multiline_start_down: ch("-"),
        bottom_right: ch("|"),
        top_left: ch(" "),
        top_right_flat: ch("-"),
        bottom_left: ch("|"),
        multiline_end_up: ch("-"),
        multiline_end_same_line: ch("-"),
        multiline_bottom_right_with_text: ch("|"),
      };
    } else if (self === "Unicode" && is_primary) {
      return {
        style: ElementStyle.UnderlinePrimary,
        underline: ch("━"),
        label_start: ch("┯"),
        vertical_text_line: ch("│"),
        multiline_vertical: ch("┃"),
        multiline_horizontal: ch("━"),
        multiline_whole_line: ch("┏"),
        multiline_start_down: ch("╿"),
        bottom_right: ch("┙"),
        top_left: ch("┏"),
        top_right_flat: ch("┛"),
        bottom_left: ch("┗"),
        multiline_end_up: ch("╿"),
        multiline_end_same_line: ch("┛"),
        multiline_bottom_right_with_text: ch("┥"),
      };
    } else {
      // (DecorStyle::Unicode, false)
      return {
        style: ElementStyle.UnderlineSecondary,
        underline: ch("─"),
        label_start: ch("┬"),
        vertical_text_line: ch("│"),
        multiline_vertical: ch("│"),
        multiline_horizontal: ch("─"),
        multiline_whole_line: ch("┌"),
        multiline_start_down: ch("│"),
        bottom_right: ch("┘"),
        top_left: ch("┌"),
        top_right_flat: ch("┘"),
        bottom_left: ch("└"),
        multiline_end_up: ch("│"),
        multiline_end_same_line: ch("┘"),
        multiline_bottom_right_with_text: ch("┤"),
      };
    }
  },
} as const;

export const debug_DecorStyle: Debug<DecorStyle> = (v) => v;
