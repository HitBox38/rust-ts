// Port of src/tools/rustfmt/src/formatting/newline_style.rs (lane rustfmt-contract-3).
import type { NewlineStyle } from "../config/mod.ts";
import type { Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";

/// Apply this newline style to the formatted text. When the style is set
/// to `Auto`, the `raw_input_text` is used to detect the existing line
/// endings.
///
/// If the style is set to `Auto` and `raw_input_text` contains no
/// newlines, the `Native` style will be used.
// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:9 apply_newline_style
export function apply_newline_style(newline_style: NewlineStyle, formatted_text: MutRef<string>, raw_input_text: string): void {
  switch (effective_newline_style(newline_style, raw_input_text)) {
    case "Windows":
      formatted_text.value = convert_to_windows_newlines(formatted_text.value);
      break;
    case "Unix":
      formatted_text.value = convert_to_unix_newlines(formatted_text.value);
      break;
  }
}

// `#[derive(Debug, Copy, Clone, PartialEq, Eq)]`
export type EffectiveNewlineStyle = "Windows" | "Unix";
export const EffectiveNewlineStyle = { Windows: "Windows", Unix: "Unix" } as const;
export const debug_EffectiveNewlineStyle: Debug<EffectiveNewlineStyle> = (v) => v;

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:26 effective_newline_style
function effective_newline_style(newline_style: NewlineStyle, raw_input_text: string): EffectiveNewlineStyle {
  switch (newline_style) {
    case "Auto":
      return auto_detect_newline_style(raw_input_text);
    case "Native":
      return native_newline_style();
    case "Windows":
      return EffectiveNewlineStyle.Windows;
    case "Unix":
      return EffectiveNewlineStyle.Unix;
  }
}

const LINE_FEED = 0x0a; // '\n'
const CARRIAGE_RETURN = 0x0d; // '\r'
const WINDOWS_NEWLINE = "\r\n";
const UNIX_NEWLINE = "\n";

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:43 auto_detect_newline_style
export function auto_detect_newline_style(raw_input_text: string): EffectiveNewlineStyle {
  // `raw_input_text.chars().position(|ch| ch == LINE_FEED)`: an index in chars (code points), not bytes.
  let first_line_feed_pos: number | undefined;
  let i = 0;
  for (const ch of raw_input_text) {
    if (ch.codePointAt(0) === LINE_FEED) {
      first_line_feed_pos = i;
      break;
    }
    i++;
  }
  if (first_line_feed_pos !== undefined) {
    const char_before_line_feed_pos = Math.max(first_line_feed_pos - 1, 0);
    // `raw_input_text.chars().nth(char_before_line_feed_pos)`
    let char_before_line_feed: number | undefined;
    let j = 0;
    for (const ch of raw_input_text) {
      if (j === char_before_line_feed_pos) {
        char_before_line_feed = ch.codePointAt(0);
        break;
      }
      j++;
    }
    switch (char_before_line_feed) {
      case CARRIAGE_RETURN:
        return EffectiveNewlineStyle.Windows;
      default:
        return EffectiveNewlineStyle.Unix;
    }
  } else {
    return native_newline_style();
  }
}

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:58 native_newline_style
export function native_newline_style(): EffectiveNewlineStyle {
  // PORT: `cfg!(windows)` is the host rust-ts runs on (the oracle runs on the same host), as in rustc_errors/emitter.ts.
  if (process.platform === "win32") {
    return EffectiveNewlineStyle.Windows;
  } else {
    return EffectiveNewlineStyle.Unix;
  }
}

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:66 convert_to_windows_newlines
function convert_to_windows_newlines(formatted_text: string): string {
  // PORT: `String::with_capacity(2 * formatted_text.capacity())`: capacity is not modelled.
  let transformed = "";
  // `formatted_text.chars().peekable()`: '\n' and '\r' are single UTF-16 units, so the peek looks one unit ahead and
  // every other code point (surrogate pairs included) is copied unchanged.
  const n = formatted_text.length;
  for (let i = 0; i < n; i++) {
    const current_char = formatted_text.charCodeAt(i);
    const next_char = i + 1 < n ? formatted_text.charCodeAt(i + 1) : undefined;
    if (current_char === LINE_FEED) {
      transformed += WINDOWS_NEWLINE;
    } else if (current_char === CARRIAGE_RETURN && next_char === LINE_FEED) {
      // dropped: the '\n' that follows writes "\r\n"
    } else {
      transformed += formatted_text[i];
    }
  }
  return transformed;
}

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:80 convert_to_unix_newlines
function convert_to_unix_newlines(formatted_text: string): string {
  return formatted_text.replaceAll(WINDOWS_NEWLINE, UNIX_NEWLINE);
}
