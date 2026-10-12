// Port of annotate-snippets =0.12.16 `src/renderer/margin.rs`.

import { debug_struct, type Debug } from "../../../std/fmt.ts";
import { saturating_sub, usize_wrapping_sub } from "../std_ext.ts";

const ELLIPSIS_PASSING = 6;
const LONG_WHITESPACE = 20;
const LONG_WHITESPACE_PADDING = 4;

export class Margin {
  constructor(
    /// The available whitespace in the left that can be consumed when centering.
    public whitespace_left: number,
    /// The column of the beginning of left-most span.
    public span_left: number,
    /// The column of the end of right-most span.
    public span_right: number,
    /// The beginning of the line to be displayed.
    public computed_left: number,
    /// The end of the line to be displayed.
    public computed_right: number,
    /// The current width of the terminal. 140 by default and in tests.
    public term_width: number,
    /// The end column of a span label, including the span. Doesn't account for labels not in the
    /// same line as the span.
    public label_right: number,
  ) {}

  // crate: annotate-snippets-0.12.16/src/renderer/margin.rs:27 new
  static new(
    whitespace_left: number,
    span_left: number,
    span_right: number,
    label_right: number,
    term_width: number,
    max_line_len: number,
  ): Margin {
    // The 6 is padding to give a bit of room for `...` when displaying:
    // ```
    // error: message
    //   --> file.rs:16:58
    //    |
    // 16 | ... fn foo(self) -> Self::Bar {
    //    |                     ^^^^^^^^^
    // ```

    const m = new Margin(
      saturating_sub(whitespace_left, ELLIPSIS_PASSING),
      saturating_sub(span_left, ELLIPSIS_PASSING),
      span_right + ELLIPSIS_PASSING,
      0,
      0,
      term_width,
      label_right + ELLIPSIS_PASSING,
    );
    m.compute(max_line_len);
    return m;
  }

  // crate: annotate-snippets-0.12.16/src/renderer/margin.rs:57 was_cut_left
  was_cut_left(): boolean {
    return this.computed_left > 0;
  }

  // crate: annotate-snippets-0.12.16/src/renderer/margin.rs:61 compute
  compute(max_line_len: number): void {
    // When there's a lot of whitespace (>20), we want to trim it as it is useless.
    this.computed_left =
      this.whitespace_left > LONG_WHITESPACE
        ? this.whitespace_left - (LONG_WHITESPACE - LONG_WHITESPACE_PADDING) // We want some padding.
        : 0;
    // We want to show as much as possible, max_line_len is the right-most boundary for the
    // relevant code.
    this.computed_right = Math.max(max_line_len, this.computed_left);

    if (this.computed_right - this.computed_left > this.term_width) {
      // Trimming only whitespace isn't enough, let's get craftier.
      if (
        saturating_sub(this.label_right, this.whitespace_left) <= this.term_width &&
        // Trimming whitespace when the right-most label is somewhrere
        // within it would result in the label pointing to the wrong
        // place
        this.label_right >= this.whitespace_left
      ) {
        // Attempt to fit the code window only trimming whitespace.
        this.computed_left = this.whitespace_left;
        this.computed_right = this.computed_left + this.term_width;
      } else if (usize_wrapping_sub(this.label_right, this.span_left) <= this.term_width) {
        // Attempt to fit the code window considering only the spans and labels.
        const padding_left = Math.floor((this.term_width - (this.label_right - this.span_left)) / 2);
        this.computed_left = saturating_sub(this.span_left, padding_left);
        this.computed_right = this.computed_left + this.term_width;
      } else if (usize_wrapping_sub(this.span_right, this.span_left) <= this.term_width) {
        // Attempt to fit the code window considering the spans and labels plus padding.
        const padding_left = Math.floor((this.term_width - (this.span_right - this.span_left)) / 5) * 2;
        this.computed_left = saturating_sub(this.span_left, padding_left);
        this.computed_right = this.computed_left + this.term_width;
      } else {
        // Mostly give up but still don't show the full line.
        this.computed_left = this.span_left;
        this.computed_right = this.span_right;
      }
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/margin.rs:101 left
  left(line_len: number): number {
    return Math.min(this.computed_left, line_len);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/margin.rs:105 right
  right(line_len: number): number {
    if (saturating_sub(line_len, this.computed_left) <= this.term_width) {
      return line_len;
    } else {
      return Math.min(line_len, this.computed_right);
    }
  }
}

export const debug_Margin: Debug<Margin> = (v, f) =>
  debug_struct(f, "Margin", [
    ["whitespace_left", String(v.whitespace_left)],
    ["span_left", String(v.span_left)],
    ["span_right", String(v.span_right)],
    ["computed_left", String(v.computed_left)],
    ["computed_right", String(v.computed_right)],
    ["term_width", String(v.term_width)],
    ["label_right", String(v.label_right)],
  ]);
