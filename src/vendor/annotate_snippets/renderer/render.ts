// Port of annotate-snippets =0.12.16 `src/renderer/render.rs`.
//
// Most of this file is adapted from https://github.com/rust-lang/rust/blob/160905b6253f42967ed4aef4b98002944c7df24c/compiler/rustc_errors/src/emitter.rs
//
// PORT: conventions (see also docs/handoff/annotate-a.md and annotate-b.md):
// - Text that is byte-indexed (`Snippet::source`, source lines, `Patch::replacement`, the spliced
//   `complete` string) is a `Str`; every `String` this file builds (normalized lines, labels,
//   titles) is a JS string, iterated by code point (`str::chars`). `.len()` of such a string is
//   `utf8_len` (bytes, like Rust).
// - `&mut usize` out-parameters (`row_num`) are `{ value }` cells.
// - `&dyn MessageOrTitle` → the value plus the impl table (`MessageOrTitle<T>`).
// - usize arithmetic: release build (no overflow checks). No subtraction in this file can wrap
//   for inputs that reach it without an earlier panic, except where noted with `usize_wrapping_sub`.
// - Import cycle: mod.ts / source_map.ts / styled_buffer.ts import this module; nothing imported
//   from them is evaluated at module top level here.

import { is_whitespace, len_utf8 } from "../../../std/char.ts";
import { debug_bool, debug_char, debug_option, debug_str, debug_struct, debug_tuple, type Debug } from "../../../std/fmt.ts";
import { assert, panic, unwrap } from "../../../std/panic.ts";
import { Str, utf8_len } from "../../../std/str.ts";
import type { Style } from "../../anstyle/style.ts";
import { UnicodeWidthChar } from "../../unicode_width/lib.ts";
import { debug_LevelInner, LevelInner, type Level } from "../level.ts";
import {
  AnnotationKind,
  debug_AnnotationKind,
  Origin,
  type Annotation,
  type Group,
  type Id,
  type Message,
  type Padding,
  type Patch,
  type Report,
  type Snippet,
  type Title,
} from "../snippet.ts";
import { index, Lines, saturating_sub, str_count_byte, str_eq, str_trim, str_trim_start, string_trim, usize_wrapping_sub } from "../std_ext.ts";
import { Margin } from "./margin.ts";
import { DecorStyle, type Renderer } from "./mod.ts";
import {
  debug_Loc,
  SourceMap,
  type AnnotatedLineInfo,
  type LineInfo,
  type Loc,
  type SplicedLines,
  type SubstitutionHighlight,
  type TrimmedPatch,
} from "./source_map.ts";
import { StyledBuffer } from "./styled_buffer.ts";
import type { Stylesheet } from "./stylesheet.ts";

const ANONYMIZED_LINE_NUM = "LL";

/** `Option<Option<&Cow<str>>>` (PORTING §5). */
type OptionPath = { readonly $: "Some"; readonly _0: string | undefined } | undefined;

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:29 render
export function render(renderer: Renderer, groups: Report): string {
  if (renderer.short_message) {
    const r = render_short_message(renderer, groups);
    if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
    return r._0;
  } else {
    const [max_line_num, og_primary_path, groups_] = pre_process(groups);
    const max_line_num_len = renderer.anonymized_line_numbers ? utf8_len(ANONYMIZED_LINE_NUM) : num_decimal_digits(max_line_num);
    const out_string = { value: "" };
    const group_len = groups_.length;
    for (let g = 0; g < groups_.length; g++) {
      const { group, elements, primary_path, max_depth } = groups_[g]!;
      const buffer = StyledBuffer.new();
      const level = group.primary_level;
      // PORT: `elements.into_iter().enumerate().peekable()` → an index; `peek` is `elements[i + 1]`.
      if (group.title !== undefined) {
        const title = group.title;
        const peek: PreProcessedElement | undefined = elements[0];
        const title_style: TitleStyle = title.allows_styling ? "Header" : "MainHeader";
        const buffer_msg_line_offset = buffer.num_lines();
        render_title(
          renderer,
          buffer,
          title,
          MessageOrTitle_for_Title,
          max_line_num_len,
          title_style,
          peek?.$ === "Message",
          buffer_msg_line_offset,
        );
        const buffer_msg_line_offset_ = buffer.num_lines();

        if (peek?.$ === "Message") {
          draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset_, max_line_num_len + 1);
        }
        if (peek === undefined && title_style === "MainHeader" && g === 0 && group_len > 1) {
          draw_col_separator_end(renderer, buffer, buffer_msg_line_offset_, max_line_num_len + 1);
        }
      }
      let seen_primary = false;
      let last_suggestion_path: OptionPath = undefined;
      for (let i = 0; i < elements.length; i++) {
        const section = elements[i]!;
        const peek: PreProcessedElement | undefined = elements[i + 1];
        const is_first = i === 0;
        switch (section.$) {
          case "Message": {
            const title = section._0;
            const title_style: TitleStyle = "Secondary";
            const buffer_msg_line_offset = buffer.num_lines();
            render_title(
              renderer,
              buffer,
              title,
              MessageOrTitle_for_Message,
              max_line_num_len,
              title_style,
              peek !== undefined,
              buffer_msg_line_offset,
            );
            break;
          }
          case "Cause": {
            const [cause, source_map, annotated_lines] = section._0;
            const is_primary: boolean = primary_path === cause.path && !seen_primary;
            seen_primary ||= is_primary;
            render_snippet_annotations(
              renderer,
              buffer,
              max_line_num_len,
              cause,
              is_primary,
              source_map,
              annotated_lines,
              max_depth,
              peek !== undefined || (g === 0 && group_len > 1),
              is_first,
            );

            if (g === 0) {
              const current_line = buffer.num_lines();
              if (peek?.$ === "Message") {
                draw_col_separator_no_space(renderer, buffer, current_line, max_line_num_len + 1);
              } else if (peek === undefined && group_len > 1) {
                draw_col_separator_end(renderer, buffer, current_line, max_line_num_len + 1);
              }
            }
            break;
          }
          case "Suggestion": {
            const [suggestion, source_map, spliced_lines, display_suggestion] = section._0;
            const matches_previous_suggestion = last_suggestion_path !== undefined && last_suggestion_path._0 === suggestion.path;
            emit_suggestion_default(
              renderer,
              buffer,
              suggestion,
              spliced_lines,
              display_suggestion,
              max_line_num_len,
              source_map,
              primary_path ?? og_primary_path,
              matches_previous_suggestion,
              is_first,
              //matches!(peek, Some(Element::Message(_) | Element::Padding(_))),
              peek !== undefined,
            );

            if (peek?.$ === "Suggestion") {
              last_suggestion_path = { $: "Some", _0: suggestion.path };
            } else {
              last_suggestion_path = undefined;
            }
            break;
          }

          case "Origin": {
            const origin = section._0;
            const buffer_msg_line_offset = buffer.num_lines();
            const is_primary: boolean = primary_path !== undefined && primary_path === origin.path && !seen_primary;
            seen_primary ||= is_primary;
            render_origin(renderer, buffer, max_line_num_len, origin, is_primary, is_first, peek === undefined, buffer_msg_line_offset);
            const current_line = buffer.num_lines();
            if (g === 0 && peek === undefined && group_len > 1) {
              draw_col_separator_end(renderer, buffer, current_line, max_line_num_len + 1);
            }
            break;
          }
          case "Padding": {
            const current_line = buffer.num_lines();
            if (peek === undefined) {
              draw_col_separator_end(renderer, buffer, current_line, max_line_num_len + 1);
            } else {
              draw_col_separator_no_space(renderer, buffer, current_line, max_line_num_len + 1);
            }
            break;
          }
        }
      }
      buffer.render(level, renderer.stylesheet, out_string);
      if (g !== group_len - 1) {
        out_string.value += "\n"; // writeln!(out_string)
      }
    }
    return out_string.value;
  }
}

// PORT: `Result<String, fmt::Error>`; writing into a `String` never fails.
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:237 render_short_message
function render_short_message(renderer: Renderer, groups: readonly Group[]): { readonly $: "Ok"; readonly _0: string } | { readonly $: "Err"; readonly _0: undefined } {
  const buffer = StyledBuffer.new();
  let labels: string | undefined = undefined;
  const group = groups[0];
  if (group === undefined) panic("Expected at least one group");

  const title = group.title;
  if (title === undefined) {
    panic("Expected a Title");
  }

  const cause_el = group.elements.find((e) => e.$ === "Cause");
  if (cause_el !== undefined && cause_el.$ === "Cause") {
    const cause = cause_el._0;
    const labels_inner = cause.markers
      .flatMap((ann): string[] => {
        const msg = ann.label;
        if (msg !== undefined && AnnotationKind.is_primary(ann.kind)) {
          if (!(string_trim(msg).length === 0)) {
            return [msg];
          } else {
            return [];
          }
        }
        return [];
      })
      .join(", ");
    if (!(labels_inner.length === 0)) {
      labels = labels_inner;
    }

    if (cause.path !== undefined) {
      const path = cause.path;
      const origin = Origin.path(path);

      const source_map = SourceMap.new(cause.source, cause.line_start);
      const [_depth, annotated_lines] = source_map.annotated_lines(cause.markers, cause.fold);

      const primary_line =
        annotated_lines.find((l) => l.annotations.some((a) => a.is_primary())) ?? annotated_lines.find((l) => !(l.annotations.length === 0));
      if (primary_line !== undefined) {
        origin.line = primary_line.line_index;
        const first_annotation = min_by_key_primary_char(primary_line.annotations);
        if (first_annotation !== undefined) {
          origin.char_column = first_annotation.start.char + 1;
        }
      }

      render_origin(renderer, buffer, 0, origin, true, true, true, 0);
      buffer.append(0, ": ", ElementStyle.LineAndColumn);
    }
  }

  render_title(
    renderer,
    buffer,
    title,
    MessageOrTitle_for_Title,
    0, // No line numbers in short messages
    "MainHeader",
    false,
    0,
  );

  if (labels !== undefined) {
    buffer.append(0, `: ${labels}`, ElementStyle.NoStyle);
  }

  const out_string = { value: "" };
  const r = buffer.render(title.level, renderer.stylesheet, out_string);
  if (r.$ === "Err") return { $: "Err", _0: undefined };

  return { $: "Ok", _0: out_string.value };
}

/** `iter.min_by_key(|a| (Reverse(a.is_primary()), a.start.char))` (first minimum wins). */
function min_by_key_primary_char(annotations: readonly LineAnnotation[]): LineAnnotation | undefined {
  let best: LineAnnotation | undefined = undefined;
  for (const a of annotations) {
    if (best === undefined) {
      best = a;
      continue;
    }
    // key: (Reverse(is_primary), start.char): primary sorts first.
    const ap = a.is_primary() ? 1 : 0;
    const bp = best.is_primary() ? 1 : 0;
    if (ap > bp || (ap === bp && a.start.char < best.start.char)) best = a;
  }
  return best;
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:318 render_title
function render_title<T>(
  renderer: Renderer,
  buffer: StyledBuffer,
  title: T,
  title_impl: MessageOrTitle<T>,
  max_line_num_len: number,
  title_style: TitleStyle,
  is_cont: boolean,
  buffer_msg_line_offset: number,
): void {
  let label_style: ElementStyle;
  let title_element_style: ElementStyle;
  switch (title_style) {
    case "MainHeader":
      label_style = { $: "Level", _0: title_impl.level(title).level };
      title_element_style = renderer.short_message ? ElementStyle.NoStyle : ElementStyle.MainHeaderMsg;
      break;
    case "Header":
      label_style = { $: "Level", _0: title_impl.level(title).level };
      title_element_style = ElementStyle.HeaderMsg;
      break;
    case "Secondary": {
      for (let _ = 0; _ < max_line_num_len; _++) {
        buffer.prepend(buffer_msg_line_offset, " ", ElementStyle.NoStyle);
      }

      draw_note_separator(renderer, buffer, buffer_msg_line_offset, max_line_num_len + 1, is_cont);
      label_style = ElementStyle.MainHeaderMsg;
      title_element_style = ElementStyle.NoStyle;
      break;
    }
  }
  let label_width = 0;

  const name = title_impl.level(title).name;
  // `title.level().name != Some(None)`
  if (!(name !== undefined && name._0 === undefined)) {
    buffer.append(buffer_msg_line_offset, title_impl.level(title).as_str(), label_style);
    label_width += utf8_len(title_impl.level(title).as_str());
    const tid = title_impl.id(title);
    if (tid !== undefined && tid.id !== undefined) {
      const id = tid.id;
      const url = tid.url;
      buffer.append(buffer_msg_line_offset, "[", label_style);
      if (url !== undefined) {
        buffer.append(buffer_msg_line_offset, `\x1B]8;;${url}\x1B\\`, label_style);
      }
      buffer.append(buffer_msg_line_offset, id, label_style);
      if (url !== undefined) {
        buffer.append(buffer_msg_line_offset, "\x1B]8;;\x1B\\", label_style);
      }
      buffer.append(buffer_msg_line_offset, "]", label_style);
      label_width += 2 + utf8_len(id);
    }
    buffer.append(buffer_msg_line_offset, ": ", title_element_style);
    label_width += 2;
  }

  const padding = " ".repeat(
    title_style === "Secondary"
      ? // The extra 3 ` ` is padding that's always needed to align to the
        // label i.e. `note: `:
        //
        //   error: message
        //     --> file.rs:13:20
        //      |
        //   13 |     <CODE>
        //      |      ^^^^
        //      |
        //      = note: multiline
        //              message
        //   ++^^^------
        //    |  |     |
        //    |  |     |
        //    |  |     width of label
        //    |  magic `3`
        //    `max_line_num_len`
        max_line_num_len + 3 + label_width
      : label_width,
  );

  let title_str: string;
  let style: ElementStyle;
  if (title_impl.allows_styling(title)) {
    title_str = title_impl.text(title);
    style = ElementStyle.NoStyle;
  } else {
    title_str = normalize_whitespace(title_impl.text(title));
    style = title_element_style;
  }
  const parts = title_str.split("\n");
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i]!;
    if (i !== 0) {
      buffer.append(buffer_msg_line_offset + i, padding, ElementStyle.NoStyle);
      if (title_style === "Secondary" && is_cont && renderer.decor_style === "Unicode") {
        // There's another note after this one, associated to the subwindow above.
        // We write additional vertical lines to join them:
        //   ╭▸ test.rs:3:3
        //   │
        // 3 │   code
        //   │   ━━━━
        //   │
        //   ├ note: foo
        //   │       bar
        //   ╰ note: foo
        //           bar
        draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset + i, max_line_num_len + 1);
      }
    }
    buffer.append(buffer_msg_line_offset + i, text, style);
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:439 render_origin
function render_origin(
  renderer: Renderer,
  buffer: StyledBuffer,
  max_line_num_len: number,
  origin: Origin,
  is_primary: boolean,
  is_first: boolean,
  alone: boolean,
  buffer_msg_line_offset: number,
): void {
  if (is_primary && !renderer.short_message) {
    buffer.prepend(buffer_msg_line_offset, DecorStyle.file_start(renderer.decor_style, is_first, alone), ElementStyle.LineNumber);
  } else if (!renderer.short_message) {
    // if !origin.standalone {
    //     // Add spacing line, as shown:
    //     //   --> $DIR/file:54:15
    //     //    |
    //     // LL |         code
    //     //    |         ^^^^
    //     //    | (<- It prints *this* line)
    //     //   ::: $DIR/other_file.rs:15:5
    //     //    |
    //     // LL |     code
    //     //    |     ----
    //     draw_col_separator_no_space(renderer,
    //         buffer,
    //         buffer_msg_line_offset,
    //         max_line_num_len + 1,
    //     );
    //
    //     buffer_msg_line_offset += 1;
    // }
    // Then, the secondary file indicator
    buffer.prepend(buffer_msg_line_offset, DecorStyle.secondary_file_start(renderer.decor_style), ElementStyle.LineNumber);
  }

  let str: string;
  if (origin.line !== undefined && origin.char_column !== undefined) {
    str = `${origin.path}:${origin.line}:${origin.char_column}`;
  } else if (origin.line !== undefined) {
    str = `${origin.path}:${origin.line}`;
  } else {
    str = origin.path;
  }

  buffer.append(buffer_msg_line_offset, str, ElementStyle.LineAndColumn);
  if (!renderer.short_message) {
    for (let _ = 0; _ < max_line_num_len; _++) {
      buffer.prepend(buffer_msg_line_offset, " ", ElementStyle.NoStyle);
    }
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:500 render_snippet_annotations
function render_snippet_annotations(
  renderer: Renderer,
  buffer: StyledBuffer,
  max_line_num_len: number,
  snippet: Snippet<Annotation>,
  is_primary: boolean,
  sm: SourceMap,
  annotated_lines: readonly AnnotatedLineInfo[],
  multiline_depth: number,
  is_cont: boolean,
  is_first: boolean,
): void {
  if (snippet.path !== undefined) {
    const path = snippet.path;
    const origin = Origin.path(path);
    // print out the span location and spacer before we print the annotated source
    // to do this, we need to know if this span will be primary
    //let is_primary = primary_path == Some(&origin.path);

    if (is_primary) {
      const primary_line =
        annotated_lines.find((l) => l.annotations.some((a) => a.is_primary())) ?? annotated_lines.find((l) => !(l.annotations.length === 0));
      if (primary_line !== undefined) {
        origin.line = primary_line.line_index;
        const first_annotation = min_by_key_primary_char(primary_line.annotations);
        if (first_annotation !== undefined) {
          origin.char_column = first_annotation.start.char + 1;
        }
      }
    } else {
      const buffer_msg_line_offset = buffer.num_lines();
      // Add spacing line, as shown:
      //   --> $DIR/file:54:15
      //    |
      // LL |         code
      //    |         ^^^^
      //    | (<- It prints *this* line)
      //   ::: $DIR/other_file.rs:15:5
      //    |
      // LL |     code
      //    |     ----
      draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset, max_line_num_len + 1);
      const first_line = annotated_lines[0];
      if (first_line !== undefined) {
        origin.line = first_line.line_index;
        const first_annotation = first_line.annotations[0];
        if (first_annotation !== undefined) {
          origin.char_column = first_annotation.start.char + 1;
        }
      }
    }
    const buffer_msg_line_offset = buffer.num_lines();
    render_origin(renderer, buffer, max_line_num_len, origin, is_primary, is_first, false, buffer_msg_line_offset);
    // Put in the spacer between the location and annotated source
    draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset + 1, max_line_num_len + 1);
  } else {
    const buffer_msg_line_offset = buffer.num_lines();
    if (is_primary) {
      if (renderer.decor_style === "Unicode") {
        buffer.puts(buffer_msg_line_offset, max_line_num_len, DecorStyle.file_start(renderer.decor_style, is_first, false), ElementStyle.LineNumber);
      } else {
        draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset, max_line_num_len + 1);
      }
    } else {
      // Add spacing line, as shown:
      //   --> $DIR/file:54:15
      //    |
      // LL |         code
      //    |         ^^^^
      //    | (<- It prints *this* line)
      //   ::: $DIR/other_file.rs:15:5
      //    |
      // LL |     code
      //    |     ----
      draw_col_separator_no_space(renderer, buffer, buffer_msg_line_offset, max_line_num_len + 1);

      buffer.puts(buffer_msg_line_offset + 1, max_line_num_len, DecorStyle.secondary_file_start(renderer.decor_style), ElementStyle.LineNumber);
    }
  }

  // Contains the vertical lines' positions for active multiline annotations
  // PORT: `Vec<(usize, ElementStyle)>`
  const multilines: [number, ElementStyle][] = [];

  // Get the left-side margin to remove it
  // PORT: `usize::MAX` sentinel → `Infinity` (only compared against and replaced).
  let whitespace_margin = Infinity;
  for (const line_info of annotated_lines) {
    let leading_whitespace = 0;
    const it = line_info.line.chars();
    for (let c = it.next(); c !== undefined && is_whitespace(c); c = it.next()) {
      // Tabs are displayed as 4 spaces
      leading_whitespace += c === 0x09 /* '\t' */ ? 4 : 1;
    }
    let any_non_ws = false;
    const it2 = line_info.line.chars();
    for (let c = it2.next(); c !== undefined; c = it2.next()) {
      if (!is_whitespace(c)) {
        any_non_ws = true;
        break;
      }
    }
    if (any_non_ws) {
      whitespace_margin = Math.min(whitespace_margin, leading_whitespace);
    }
  }
  if (whitespace_margin === Infinity) {
    whitespace_margin = 0;
  }

  // Left-most column any visible span points at.
  let span_left_margin = Infinity;
  for (const line_info of annotated_lines) {
    for (const ann of line_info.annotations) {
      span_left_margin = Math.min(span_left_margin, ann.start.display);
      span_left_margin = Math.min(span_left_margin, ann.end.display);
    }
  }
  if (span_left_margin === Infinity) {
    span_left_margin = 0;
  }

  // Right-most column any visible span points at.
  let span_right_margin = 0;
  let label_right_margin = 0;
  let max_line_len = 0;
  for (const line_info of annotated_lines) {
    max_line_len = Math.max(max_line_len, str_width(line_info.line));
    for (const ann of line_info.annotations) {
      span_right_margin = Math.max(span_right_margin, ann.start.display);
      span_right_margin = Math.max(span_right_margin, ann.end.display);
      // FIXME: account for labels not in the same line
      const label_right = ann.label === undefined ? 0 : str_width(ann.label) + 1;
      label_right_margin = Math.max(label_right_margin, ann.end.display + label_right);
    }
  }
  const width_offset = 3 + max_line_num_len;
  const code_offset = multiline_depth === 0 ? width_offset : width_offset + multiline_depth + 1;

  const column_width = saturating_sub(renderer.term_width, code_offset);

  const margin = Margin.new(whitespace_margin, span_left_margin, span_right_margin, label_right_margin, column_width, max_line_len);

  // Next, output the annotate source for this file
  for (let annotated_line_idx = 0; annotated_line_idx < annotated_lines.length; annotated_line_idx++) {
    const previous_buffer_line = buffer.num_lines();

    const depths = render_source_line(
      renderer,
      annotated_lines[annotated_line_idx]!,
      buffer,
      width_offset,
      code_offset,
      max_line_num_len,
      margin,
      !is_cont && annotated_line_idx + 1 === annotated_lines.length,
    );

    // PORT: `BTreeMap<usize, ElementStyle>` → a Map whose keys are sorted when it is drained.
    const to_add = new Map<number, ElementStyle>();

    for (const [depth, style] of depths) {
      const index_ = multilines.findIndex(([d, _]) => d === depth);
      if (index_ !== -1) {
        // multilines.swap_remove(index)
        const last = multilines.pop()!;
        if (index_ < multilines.length) multilines[index_] = last;
      } else {
        to_add.set(depth, style);
      }
    }

    // Set the multiline annotation vertical lines to the left of
    // the code in this line.
    for (const [depth, style] of multilines) {
      for (let line = previous_buffer_line; line < buffer.num_lines(); line++) {
        draw_multiline_line(renderer, buffer, line, width_offset, depth, style);
      }
    }
    // check to see if we need to print out or elide lines that come between
    // this annotated line and the next one.
    if (annotated_line_idx < annotated_lines.length - 1) {
      const line_idx_delta = annotated_lines[annotated_line_idx + 1]!.line_index - annotated_lines[annotated_line_idx]!.line_index;
      if (line_idx_delta > 2) {
        const last_buffer_line_num = buffer.num_lines();

        draw_line_separator(renderer, buffer, last_buffer_line_num, width_offset);

        // Set the multiline annotation vertical lines on `...` bridging line.
        for (const [depth, style] of multilines) {
          draw_multiline_line(renderer, buffer, last_buffer_line_num, width_offset, depth, style);
        }
        const line = annotated_lines[annotated_line_idx];
        if (line !== undefined) {
          for (const ann of line.annotations) {
            if (ann.annotation_type.$ === "MultilineStart") {
              const pos = ann.annotation_type._0;
              // In the case where we have elided the entire start of the
              // multispan because those lines were empty, we still need
              // to draw the `|`s across the `...`.
              draw_multiline_line(
                renderer,
                buffer,
                last_buffer_line_num,
                width_offset,
                pos,
                ann.is_primary() ? ElementStyle.UnderlinePrimary : ElementStyle.UnderlineSecondary,
              );
            }
          }
        }
      } else if (line_idx_delta === 2) {
        const unannotated_line = sm.get_line(annotated_lines[annotated_line_idx]!.line_index + 1) ?? EMPTY_STR;

        const last_buffer_line_num = buffer.num_lines();

        draw_line(
          renderer,
          buffer,
          normalize_whitespace(unannotated_line.toString()),
          annotated_lines[annotated_line_idx + 1]!.line_index - 1,
          last_buffer_line_num,
          width_offset,
          code_offset,
          max_line_num_len,
          margin,
        );

        for (const [depth, style] of multilines) {
          draw_multiline_line(renderer, buffer, last_buffer_line_num, width_offset, depth, style);
        }
        const line = annotated_lines[annotated_line_idx];
        if (line !== undefined) {
          for (const ann of line.annotations) {
            if (ann.annotation_type.$ === "MultilineStart") {
              const pos = ann.annotation_type._0;
              draw_multiline_line(
                renderer,
                buffer,
                last_buffer_line_num,
                width_offset,
                pos,
                ann.is_primary() ? ElementStyle.UnderlinePrimary : ElementStyle.UnderlineSecondary,
              );
            }
          }
        }
      } else {
        // Ordering::Less => {}
      }
    }

    // multilines.extend(to_add) (BTreeMap iterates in key order)
    for (const depth of [...to_add.keys()].sort((a, b) => a - b)) {
      multilines.push([depth, to_add.get(depth)!]);
    }
  }
}

const EMPTY_STR: Str = Str.from("");

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:825 render_source_line
function render_source_line(
  renderer: Renderer,
  line_info: AnnotatedLineInfo,
  buffer: StyledBuffer,
  width_offset: number,
  code_offset: number,
  max_line_num_len: number,
  margin: Margin,
  close_window: boolean,
): [number, ElementStyle][] {
  // Draw:
  //
  //   LL | ... code ...
  //      |     ^^-^ span label
  //      |       |
  //      |       secondary span label
  //
  //   ^^ ^ ^^^ ^^^^ ^^^ we don't care about code too far to the right of a span, we trim it
  //   |  | |   |
  //   |  | |   actual code found in your source code and the spans we use to mark it
  //   |  | when there's too much wasted space to the left, trim it
  //   |  vertical divider between the column number and the code
  //   column number

  const source_string = normalize_whitespace(line_info.line.toString());

  const line_offset = buffer.num_lines();

  const left = draw_line(renderer, buffer, source_string, line_info.line_index, line_offset, width_offset, code_offset, max_line_num_len, margin);

  // If there are no annotations, we are done
  if (line_info.annotations.length === 0) {
    // `close_window` normally gets handled later, but we are early
    // returning, so it needs to be handled here
    if (close_window) {
      draw_col_separator_end(renderer, buffer, line_offset + 1, width_offset - 2);
    }
    return [];
  }

  // Special case when there's only one annotation involved, it is the start of a multiline
  // span and there's no text at the beginning of the code line. Instead of doing the whole
  // graph:
  //
  // 2 |   fn foo() {
  //   |  _^
  // 3 | |
  // 4 | | }
  //   | |_^ test
  //
  // we simplify the output to:
  //
  // 2 | / fn foo() {
  // 3 | |
  // 4 | | }
  //   | |_^ test
  const buffer_ops: [number, number, number, ElementStyle][] = [];
  const annotations_: [number, ElementStyle][] = [];
  let short_start = true;
  for (const ann of line_info.annotations) {
    if (ann.annotation_type.$ === "MultilineStart") {
      const depth = ann.annotation_type._0;
      let all_ws = true;
      let k = 0;
      for (const c of source_string) {
        if (k >= ann.start.display) break;
        k++;
        if (!is_whitespace(c.codePointAt(0)!)) {
          all_ws = false;
          break;
        }
      }
      if (all_ws) {
        const uline = DecorStyle.underline(renderer.decor_style, ann.is_primary());
        const chr = uline.multiline_whole_line;
        annotations_.push([depth, uline.style]);
        buffer_ops.push([line_offset, width_offset + depth - 1, chr, uline.style]);
      } else {
        short_start = false;
        break;
      }
    } else if (ann.annotation_type.$ === "MultilineLine") {
    } else {
      short_start = false;
      break;
    }
  }
  if (short_start) {
    for (const [y, x, c, s] of buffer_ops) {
      buffer.putc(y, x, c, s);
    }
    return annotations_;
  }

  // We want to display like this:
  //
  //      vec.push(vec.pop().unwrap());
  //      ---      ^^^               - previous borrow ends here
  //      |        |
  //      |        error occurs here
  //      previous borrow of `vec` occurs here
  //
  // But there are some weird edge cases to be aware of:
  //
  //      vec.push(vec.pop().unwrap());
  //      --------                    - previous borrow ends here
  //      ||
  //      |this makes no sense
  //      previous borrow of `vec` occurs here
  //
  // For this reason, we group the lines into "highlight lines"
  // and "annotations lines", where the highlight lines have the `^`.

  // Sort the annotations by (start, end col)
  // The labels are reversed, sort and then reversed again.
  // Consider a list of annotations (A1, A2, C1, C2, B1, B2) where
  // the letter signifies the span. Here we are only sorting by the
  // span and hence, the order of the elements with the same span will
  // not change. On reversing the ordering (|a, b| but b.cmp(a)), you get
  // (C1, C2, B1, B2, A1, A2). All the elements with the same span are
  // still ordered first to last, but all the elements with different
  // spans are ordered by their spans in last to first order. Last to
  // first order is important, because the jiggly lines and | are on
  // the left, so the rightmost span needs to be rendered first,
  // otherwise the lines would end up needing to go over a message.

  // PORT: `.clone()` of `Vec<LineAnnotation>`; the elements are only read below, so a shallow
  // copy of the vector is enough. `sort_by_key` is stable, like `Array.prototype.sort`.
  const annotations = line_info.annotations.slice();
  annotations.sort((a, b) => {
    // Reverse((a.start.display, a.start.char))
    if (a.start.display !== b.start.display) return b.start.display - a.start.display;
    return b.start.char - a.start.char;
  });

  // First, figure out where each label will be positioned.
  //
  // In the case where you have the following annotations:
  //
  //      vec.push(vec.pop().unwrap());
  //      --------                    - previous borrow ends here [C]
  //      ||
  //      |this makes no sense [B]
  //      previous borrow of `vec` occurs here [A]
  //
  // `annotations_position` will hold [(2, A), (1, B), (0, C)].
  //
  // We try, when possible, to stick the rightmost annotation at the end
  // of the highlight line:
  //
  //      vec.push(vec.pop().unwrap());
  //      ---      ---               - previous borrow ends here
  //
  // But sometimes that's not possible because one of the other
  // annotations overlaps it. For example, from the test
  // `span_overlap_label`, we have the following annotations
  // (written on distinct lines for clarity):
  //
  //      fn foo(x: u32) {
  //      --------------
  //             -
  //
  // In this case, we can't stick the rightmost-most label on
  // the highlight line, or we would get:
  //
  //      fn foo(x: u32) {
  //      -------- x_span
  //      |
  //      fn_span
  //
  // which is totally weird. Instead we want:
  //
  //      fn foo(x: u32) {
  //      --------------
  //      |      |
  //      |      x_span
  //      fn_span
  //
  // which is...less weird, at least. In fact, in general, if
  // the rightmost span overlaps with any other span, we should
  // use the "hang below" version, so we can at least make it
  // clear where the span *starts*. There's an exception for this
  // logic, when the labels do not have a message:
  //
  //      fn foo(x: u32) {
  //      --------------
  //             |
  //             x_span
  //
  // instead of:
  //
  //      fn foo(x: u32) {
  //      --------------
  //      |      |
  //      |      x_span
  //      <EMPTY LINE>
  //
  const overlap: boolean[] = new Array<boolean>(annotations.length).fill(false);
  const annotations_position: [number, LineAnnotation][] = [];
  let line_len = 0;
  let p = 0;
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i]!;
    for (let j = 0; j < annotations.length; j++) {
      const next = annotations[j]!;
      if (overlaps(next, annotation, 0) && j > 1) {
        overlap[i] = true;
        overlap[j] = true;
      }
      if (
        overlaps(next, annotation, 0) && // This label overlaps with another one and both
        annotation.has_label() && // take space (they have text and are not
        j > i && // multiline lines).
        p === 0
        // We're currently on the first line, move the label one line down
      ) {
        // If we're overlapping with an un-labelled annotation with the same span
        // we can just merge them in the output
        if (
          next.start.display === annotation.start.display &&
          next.start.char === annotation.start.char &&
          next.end.display === annotation.end.display &&
          next.end.char === annotation.end.char &&
          !next.has_label()
        ) {
          continue;
        }

        // This annotation needs a new line in the output.
        p += 1;
        break;
      }
    }
    annotations_position.push([p, annotation]);
    for (let j = 0; j < annotations.length; j++) {
      const next = annotations[j]!;
      if (j > i) {
        const l = next.label === undefined ? 0 : utf8_len(next.label) + 2;
        if (
          (overlaps(next, annotation, l) && // Do not allow two labels to be in the same
            // line if they overlap including padding, to
            // avoid situations like:
            //
            //      fn foo(x: u32) {
            //      -------^------
            //      |      |
            //      fn_spanx_span
            //
            annotation.has_label() && // Both labels must have some text, otherwise
            next.has_label()) || // they are not overlapping.
          // Do not add a new line if this annotation
          // or the next are vertical line placeholders.
          (annotation.takes_space() && // If either this or the next annotation is
            next.has_label()) || // multiline start/end, move it to a new line
          (annotation.has_label() && // so as not to overlap the horizontal lines.
            next.takes_space()) ||
          (annotation.takes_space() && next.takes_space()) ||
          (overlaps(next, annotation, l) &&
            tuple_le(next.end.display, next.end.char, annotation.end.display, annotation.end.char) &&
            next.has_label() &&
            p === 0)
          // Avoid #42595.
        ) {
          // This annotation needs a new line in the output.
          p += 1;
          break;
        }
      }
    }
    line_len = Math.max(line_len, p);
  }

  if (line_len !== 0) {
    line_len += 1;
  }

  // If there are no annotations or the only annotations on this line are
  // MultilineLine, then there's only code being shown, stop processing.
  if (line_info.annotations.every((a) => a.is_line())) {
    return [];
  }

  if (annotations_position.every(([_, ann]) => ann.annotation_type.$ === "MultilineStart")) {
    let max_pos: number | undefined = undefined;
    for (const [pos, _] of annotations_position) if (max_pos === undefined || pos >= max_pos) max_pos = pos;
    if (max_pos !== undefined) {
      // Special case the following, so that we minimize overlapping multiline spans.
      //
      // 3 │       X0 Y0 Z0
      //   │ ┏━━━━━┛  │  │     < We are writing these lines
      //   │ ┃┌───────┘  │     < by reverting the "depth" of
      //   │ ┃│┌─────────┘     < their multiline spans.
      // 4 │ ┃││   X1 Y1 Z1
      // 5 │ ┃││   X2 Y2 Z2
      //   │ ┃│└────╿──│──┘ `Z` label
      //   │ ┃└─────│──┤
      //   │ ┗━━━━━━┥  `Y` is a good letter too
      //   ╰╴       `X` is a good letter
      for (const ap of annotations_position) {
        ap[0] = max_pos - ap[0];
      }
      // We know then that we don't need an additional line for the span label, saving us
      // one line of vertical space.
      line_len = saturating_sub(line_len, 1);
    }
  }

  // Write the column separator.
  //
  // After this we will have:
  //
  // 2 |   fn foo() {
  //   |
  //   |
  //   |
  // 3 |
  // 4 |   }
  //   |
  for (let pos = 0; pos <= line_len; pos++) {
    draw_col_separator_no_space(renderer, buffer, line_offset + pos + 1, width_offset - 2);
  }
  if (close_window) {
    draw_col_separator_end(renderer, buffer, line_offset + line_len + 1, width_offset - 2);
  }
  // Write the horizontal lines for multiline annotations
  // (only the first and last lines need this).
  //
  // After this we will have:
  //
  // 2 |   fn foo() {
  //   |  __________
  //   |
  //   |
  // 3 |
  // 4 |   }
  //   |  _
  for (const [pos_, annotation] of annotations_position) {
    const underline = DecorStyle.underline(renderer.decor_style, annotation.is_primary());
    const pos = pos_ + 1;
    const at = annotation.annotation_type;
    if (at.$ === "MultilineStart" || at.$ === "MultilineEnd") {
      const depth = at._0;
      draw_range(
        buffer,
        underline.multiline_horizontal,
        line_offset + pos,
        width_offset + depth,
        saturating_sub(code_offset + annotation.start.display, left),
        underline.style,
      );
    } else if (annotation.highlight_source) {
      buffer.set_style_range(
        line_offset,
        saturating_sub(code_offset + annotation.start.char, left),
        saturating_sub(code_offset + annotation.end.char, left),
        underline.style,
        annotation.is_primary(),
      );
    }
  }

  // Write the vertical lines for labels that are on a different line as the underline.
  //
  // After this we will have:
  //
  // 2 |   fn foo() {
  //   |  __________
  //   | |    |
  //   | |
  // 3 | |
  // 4 | | }
  //   | |_
  for (const [pos_, annotation] of annotations_position) {
    const underline = DecorStyle.underline(renderer.decor_style, annotation.is_primary());
    const pos = pos_ + 1;

    if (pos > 1 && (annotation.has_label() || annotation.takes_space())) {
      for (let p = line_offset + 1; p <= line_offset + pos; p++) {
        buffer.putc(
          p,
          saturating_sub(code_offset + annotation.start.display, left),
          annotation.annotation_type.$ === "MultilineLine" ? underline.multiline_vertical : underline.vertical_text_line,
          underline.style,
        );
      }
      if (annotation.annotation_type.$ === "MultilineStart") {
        buffer.putc(line_offset + pos, saturating_sub(code_offset + annotation.start.display, left), underline.bottom_right, underline.style);
      }
      if (annotation.annotation_type.$ === "MultilineEnd" && annotation.has_label()) {
        buffer.putc(
          line_offset + pos,
          saturating_sub(code_offset + annotation.start.display, left),
          underline.multiline_bottom_right_with_text,
          underline.style,
        );
      }
    }
    const at = annotation.annotation_type;
    switch (at.$) {
      case "MultilineStart": {
        const depth = at._0;
        buffer.putc(line_offset + pos, width_offset + depth - 1, underline.top_left, underline.style);
        for (let p = line_offset + pos + 1; p < line_offset + line_len + 2; p++) {
          buffer.putc(p, width_offset + depth - 1, underline.multiline_vertical, underline.style);
        }
        break;
      }
      case "MultilineEnd": {
        const depth = at._0;
        for (let p = line_offset; p < line_offset + pos; p++) {
          buffer.putc(p, width_offset + depth - 1, underline.multiline_vertical, underline.style);
        }
        buffer.putc(line_offset + pos, width_offset + depth - 1, underline.bottom_left, underline.style);
        break;
      }
      default:
        break;
    }
  }

  // Write the labels on the annotations that actually have a label.
  //
  // After this we will have:
  //
  // 2 |   fn foo() {
  //   |  __________
  //   |      |
  //   |      something about `foo`
  // 3 |
  // 4 |   }
  //   |  _  test
  for (const [pos_, annotation] of annotations_position) {
    const style = annotation.is_primary() ? ElementStyle.LabelPrimary : ElementStyle.LabelSecondary;
    let pos: number;
    let col: number;
    if (pos_ === 0) {
      if (annotation.end.display === 0) {
        [pos, col] = [pos_ + 1, saturating_sub(annotation.end.display + 2, left)];
      } else {
        [pos, col] = [pos_ + 1, saturating_sub(annotation.end.display + 1, left)];
      }
    } else {
      [pos, col] = [pos_ + 2, saturating_sub(annotation.start.display, left)];
    }
    if (annotation.label !== undefined) {
      buffer.puts(line_offset + pos, code_offset + col, annotation.label, style);
    }
  }

  // Sort from biggest span to smallest span so that smaller spans are
  // represented in the output:
  //
  // x | fn foo()
  //   | ^^^---^^
  //   | |  |
  //   | |  something about `foo`
  //   | something about `fn foo()`
  annotations_position.sort(([_a, a], [_b, b]) => {
    // Decreasing order. When annotations share the same length, prefer `Primary`.
    // key: (Reverse(ann.len()), ann.is_primary())
    if (a.len() !== b.len()) return b.len() - a.len();
    return (a.is_primary() ? 1 : 0) - (b.is_primary() ? 1 : 0);
  });

  // Write the underlines.
  //
  // After this we will have:
  //
  // 2 |   fn foo() {
  //   |  ____-_____^
  //   |      |
  //   |      something about `foo`
  // 3 |
  // 4 |   }
  //   |  _^  test
  for (const [pos, annotation] of annotations_position) {
    const uline = DecorStyle.underline(renderer.decor_style, annotation.is_primary());
    for (let p = annotation.start.display; p < annotation.end.display; p++) {
      // The default span label underline.
      buffer.putc(line_offset + 1, saturating_sub(code_offset + p, left), uline.underline, uline.style);
    }

    const at = annotation.annotation_type;
    if (pos === 0 && (at.$ === "MultilineStart" || at.$ === "MultilineEnd")) {
      // The beginning of a multiline span with its leftward moving line on the same line.
      buffer.putc(
        line_offset + 1,
        saturating_sub(code_offset + annotation.start.display, left),
        at.$ === "MultilineStart" ? uline.top_right_flat : uline.multiline_end_same_line,
        uline.style,
      );
    } else if (pos !== 0 && (at.$ === "MultilineStart" || at.$ === "MultilineEnd")) {
      // The beginning of a multiline span with its leftward moving line on another line,
      // so we start going down first.
      buffer.putc(
        line_offset + 1,
        saturating_sub(code_offset + annotation.start.display, left),
        at.$ === "MultilineStart" ? uline.multiline_start_down : uline.multiline_end_up,
        uline.style,
      );
    } else if (pos !== 0 && annotation.has_label()) {
      // The beginning of a span label with an actual label, we'll point down.
      buffer.putc(line_offset + 1, saturating_sub(code_offset + annotation.start.display, left), uline.label_start, uline.style);
    }
  }

  // We look for individual *long* spans, and we trim the *middle*, so that we render
  // LL | ...= [0, 0, 0, ..., 0, 0];
  //    |      ^^^^^^^^^^...^^^^^^^ expected `&[u8]`, found `[{integer}; 1680]`
  for (let i = 0; i < annotations_position.length; i++) {
    const [_pos, annotation] = annotations_position[i]!;
    // Skip cases where multiple spans overlap eachother.
    if (overlap[i]) {
      continue;
    }
    if (annotation.annotation_type.$ !== "Singleline") {
      continue;
    }
    const width = annotation.end.display - annotation.start.display;

    const MIN_PAD = 5;
    const margin_width = str_width(DecorStyle.margin(renderer.decor_style));
    if (width > margin.term_width * 2 && width > MIN_PAD * 2 + margin_width) {
      // If the terminal is *too* small, we keep at least a tiny bit of the span for
      // display.
      const pad = Math.max(Math.floor(margin.term_width / 3), MIN_PAD);
      // Code line
      buffer.replace(
        line_offset,
        code_offset + saturating_sub(annotation.start.display + pad, left),
        code_offset + saturating_sub(annotation.end.display - pad, left),
        DecorStyle.margin(renderer.decor_style),
      );
      // Underline line
      buffer.replace(
        line_offset + 1,
        code_offset + saturating_sub(annotation.start.display + pad, left),
        code_offset + saturating_sub(annotation.end.display - pad, left),
        DecorStyle.margin(renderer.decor_style),
      );
    }
  }
  const out: [number, ElementStyle][] = [];
  for (const [_, annotation] of annotations_position) {
    const at = annotation.annotation_type;
    if (at.$ === "MultilineStart" || at.$ === "MultilineEnd") {
      const style = annotation.is_primary() ? ElementStyle.LabelPrimary : ElementStyle.LabelSecondary;
      out.push([at._0, style]);
    }
  }
  return out;
}

/** `(a0, a1) <= (b0, b1)` on tuples of usize. */
function tuple_le(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b0 || (a0 === b0 && a1 <= b1);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:1435 emit_suggestion_default
function emit_suggestion_default(
  renderer: Renderer,
  buffer: StyledBuffer,
  suggestion: Snippet<Patch>,
  spliced_lines: SplicedLines,
  show_code_change: DisplaySuggestion,
  max_line_num_len: number,
  sm: SourceMap,
  primary_path: string | undefined,
  matches_previous_suggestion: boolean,
  is_first: boolean,
  is_cont: boolean,
): void {
  const buffer_offset = buffer.num_lines();
  const row_num = { value: buffer_offset + (!matches_previous_suggestion ? 1 : 0) };
  const [complete, parts, highlights, replaced_highlights] = spliced_lines;
  const is_multiline = Lines.new(complete).count() > 1;

  if (matches_previous_suggestion) {
    buffer.puts(row_num.value - 1, max_line_num_len + 1, DecorStyle.multi_suggestion_separator(renderer.decor_style), ElementStyle.LineNumber);
  } else {
    draw_col_separator_start(renderer, buffer, row_num.value - 1, max_line_num_len + 1);
  }
  if (suggestion.path !== primary_path) {
    if (suggestion.path !== undefined) {
      const path = suggestion.path;
      if (!matches_previous_suggestion) {
        const [loc, _] = sm.span_to_locations(index(parts, 0).span);
        // --> file.rs:line:col
        //  |
        const arrow = DecorStyle.file_start(renderer.decor_style, is_first, false);
        buffer.puts(row_num.value - 1, 0, arrow, ElementStyle.LineNumber);
        const message = `${path}:${loc.line}:${loc.char + 1}`;
        const col = Math.max(max_line_num_len + 1, str_width(arrow));
        buffer.puts(row_num.value - 1, col, message, ElementStyle.LineAndColumn);
        for (let _ = 0; _ < max_line_num_len; _++) {
          buffer.prepend(row_num.value - 1, " ", ElementStyle.NoStyle);
        }
        draw_col_separator_no_space(renderer, buffer, row_num.value, max_line_num_len + 1);
        row_num.value += 1;
      }
    }
  }

  if (show_code_change === "Diff") {
    row_num.value += 1;
  }

  let lo: number | undefined = undefined;
  for (const p of parts) if (lo === undefined || p.span.start < lo) lo = p.span.start;
  let hi: number | undefined = undefined;
  for (const p of parts) if (hi === undefined || p.span.end > hi) hi = p.span.end;
  lo = unwrap(lo);
  hi = unwrap(hi);

  const file_lines = sm.span_to_lines({ start: lo, end: hi });
  const [line_start, line_end] = suggestion.fold
    ? // We use the original span to get original line_start
      sm.span_to_locations(index(parts, 0).original_span)
    : sm.span_to_locations({ start: 0, end: sm.source.len() });
  const lines = Lines.new(complete);
  if (lines.clone().next() === undefined) {
    // Account for a suggestion to completely remove a line(s) with whitespace (#94192).
    for (let line = line_start.line; line <= line_end.line; line++) {
      buffer.puts(row_num.value - 1 + line - line_start.line, 0, maybe_anonymized(renderer, line, max_line_num_len), ElementStyle.LineNumber);
      buffer.puts(row_num.value - 1 + line - line_start.line, max_line_num_len + 1, "- ", ElementStyle.Removal);
      buffer.puts(
        row_num.value - 1 + line - line_start.line,
        max_line_num_len + 3,
        normalize_whitespace(unwrap(sm.get_line(line)).toString()),
        ElementStyle.Removal,
      );
    }
    row_num.value += line_end.line - line_start.line;
  }
  const unhighlighted_lines: [number, Str][] = [];
  // PORT: `lines.by_ref().zip(highlights).enumerate()`: `Zip` pulls from `lines` first, so when
  // `highlights` runs out one more line is consumed from `lines` (observable below).
  let line_pos = 0;
  let h = 0;
  for (;;) {
    const line = lines.next();
    if (line === undefined) break;
    if (h >= highlights.length) break;
    const highlight_parts = highlights[h++]!;
    const lp = line_pos++;
    // Remember lines that are not highlighted to hide them if needed
    if (highlight_parts.length === 0 && suggestion.fold) {
      unhighlighted_lines.push([lp, line]);
      continue;
    }

    const n = unhighlighted_lines.length;
    if (n === 0) {
      // 0 => (),
    } else if (n <= 3) {
      // Since we show first line, "..." line and last line,
      // There is no reason to hide if there are 3 or less lines
      // (because then we just replace a line with ... which is
      // not helpful)
      for (const [p, l] of unhighlighted_lines.splice(0)) {
        draw_code_line(
          renderer,
          buffer,
          row_num,
          [],
          [],
          p + line_start.line,
          l,
          show_code_change,
          max_line_num_len,
          file_lines,
          is_multiline,
        );
      }
    } else {
      // Print first unhighlighted line, "..." and last unhighlighted line, like so:
      //
      // LL | this line was highlighted
      // LL | this line is just for context
      // ...
      // LL | this line is just for context
      // LL | this line was highlighted
      const last_line = unhighlighted_lines.pop();
      const first_line = unhighlighted_lines.splice(0)[0];

      if (first_line !== undefined) {
        const [p, l] = first_line;
        draw_code_line(
          renderer,
          buffer,
          row_num,
          [],
          [],
          p + line_start.line,
          l,
          show_code_change,
          max_line_num_len,
          file_lines,
          is_multiline,
        );
      }

      const placeholder = DecorStyle.margin(renderer.decor_style);
      const padding = str_width(placeholder);
      buffer.puts(row_num.value, saturating_sub(max_line_num_len, padding), placeholder, ElementStyle.LineNumber);
      row_num.value += 1;

      if (last_line !== undefined) {
        const [p, l] = last_line;
        draw_code_line(
          renderer,
          buffer,
          row_num,
          [],
          [],
          p + line_start.line,
          l,
          show_code_change,
          max_line_num_len,
          file_lines,
          is_multiline,
        );
      }
    }
    draw_code_line(
      renderer,
      buffer,
      row_num,
      highlight_parts,
      replaced_highlights,
      lp + line_start.line,
      line,
      show_code_change,
      max_line_num_len,
      file_lines,
      is_multiline,
    );
  }

  // This offset and the ones below need to be signed to account for replacement code
  // that is shorter than the original code.
  const offsets: [number, number][] = [];
  // Only show an underline in the suggestions if the suggestion is not the
  // entirety of the code being shown and the displayed code is not multiline.
  if (show_code_change === "Diff" || show_code_change === "Underline" || show_code_change === "Add") {
    for (const part of parts) {
      const [span_start, span_end] = sm.span_to_locations(part.span);
      const span_start_pos = span_start.display;
      const span_end_pos = span_end.display;

      // If this addition is _only_ whitespace, then don't trim it,
      // or else we're just not rendering anything.
      const is_whitespace_addition = str_trim(part.replacement).is_empty();

      // Do not underline the leading...
      const start = is_whitespace_addition ? 0 : saturating_sub(part.replacement.len(), str_trim_start(part.replacement).len());
      // ...or trailing spaces. Account for substitutions containing unicode
      // characters.
      const sub_len = str_width(is_whitespace_addition ? part.replacement : str_trim(part.replacement));

      let offset = 0;
      for (const [start_, v] of offsets) {
        if (span_start_pos < start_) {
          // None
        } else {
          offset += v;
        }
      }
      const underline_start = span_start_pos + start + offset;
      const underline_end = span_start_pos + start + sub_len + offset;
      assert(underline_start >= 0 && underline_end >= 0, "assertion failed: underline_start >= 0 && underline_end >= 0");
      const padding = max_line_num_len + 3;
      for (let p = underline_start; p < underline_end; p++) {
        if (show_code_change === "Underline") {
          // If this is a replacement, underline with `~`, if this is an addition
          // underline with `+`.
          buffer.putc(
            row_num.value,
            padding + p,
            part.is_addition(sm) ? 0x2b /* '+' */ : DecorStyle.diff(renderer.decor_style),
            ElementStyle.Addition,
          );
        }
      }

      // length of the code after substitution
      const full_sub_len = str_width(part.replacement);

      // length of the code to be substituted
      const snippet_len = span_end_pos - span_start_pos;
      // For multiple substitutions, use the position *after* the previous
      // substitutions have happened, only when further substitutions are
      // located strictly after.
      offsets.push([span_end_pos, full_sub_len - snippet_len]);
    }
    row_num.value += 1;
  }

  // if we elided some lines, add an ellipsis
  if (lines.next() !== undefined) {
    const placeholder = DecorStyle.margin(renderer.decor_style);
    const padding = str_width(placeholder);
    buffer.puts(row_num.value, saturating_sub(max_line_num_len, padding), placeholder, ElementStyle.LineNumber);
  } else {
    let row: number;
    switch (show_code_change) {
      case "Diff":
      case "Add":
      case "Underline":
        row = row_num.value - 1;
        break;
      case "None":
        row = row_num.value;
        break;
    }
    if (is_cont) {
      draw_col_separator_no_space(renderer, buffer, row, max_line_num_len + 1);
    } else {
      draw_col_separator_end(renderer, buffer, row, max_line_num_len + 1);
    }
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:1723 draw_code_line
function draw_code_line(
  renderer: Renderer,
  buffer: StyledBuffer,
  row_num: { value: number },
  highlight_parts: readonly SubstitutionHighlight[],
  replaced_parts: readonly (readonly SubstitutionHighlight[])[],
  line_num: number,
  line_to_add: Str,
  show_code_change: DisplaySuggestion,
  max_line_num_len: number,
  file_lines: readonly LineInfo[],
  is_multiline: boolean,
): void {
  if (show_code_change === "Diff") {
    // We need to print more than one line if the span we need to remove is multiline.
    // For more info: https://github.com/rust-lang/rust/issues/92741
    // PORT: `take(file_lines.len() - 1)` wraps to `usize::MAX` for an empty `file_lines` (then
    // `last().unwrap()` below panics).
    const take = Math.min(usize_wrapping_sub(file_lines.length, 1), file_lines.length, replaced_parts.length);
    for (let index_ = 0; index_ < take; index_++) {
      const line_to_remove = file_lines[index_]!;
      const parts = replaced_parts[index_]!;
      buffer.puts(row_num.value - 1, 0, maybe_anonymized(renderer, line_num + index_, max_line_num_len), ElementStyle.LineNumber);
      buffer.puts(row_num.value - 1, max_line_num_len + 1, "- ", ElementStyle.Removal);
      const line = normalize_whitespace(line_to_remove.line.toString());
      buffer.puts(row_num.value - 1, max_line_num_len + 3, line, ElementStyle.NoStyle);
      style_substitution_highlights(parts, ElementStyle.Removal, row_num.value - 1, line_to_remove.line, max_line_num_len, buffer);
      row_num.value += 1;
    }
    // If the last line is exactly equal to the line we need to add, we can skip both of
    // them. This allows us to avoid output like the following:
    // 2 - &
    // 2 + if true { true } else { false }
    // 3 - if true { true } else { false }
    // If those lines aren't equal, we print their diff
    const last_line = unwrap(file_lines[file_lines.length - 1]);
    if (str_eq(last_line.line, line_to_add)) {
      row_num.value -= 2;
      // The last original line collapses into the previous drawn row, so
      // fold its replaced-code highlights onto that row too.
      style_substitution_highlights(
        unwrap(replaced_parts[replaced_parts.length - 1]),
        ElementStyle.Removal,
        row_num.value,
        last_line.line,
        max_line_num_len,
        buffer,
      );
    } else {
      buffer.puts(
        row_num.value - 1,
        0,
        maybe_anonymized(renderer, line_num + file_lines.length - 1, max_line_num_len),
        ElementStyle.LineNumber,
      );
      buffer.puts(row_num.value - 1, max_line_num_len + 1, "- ", ElementStyle.Removal);
      buffer.puts(row_num.value - 1, max_line_num_len + 3, normalize_whitespace(last_line.line.toString()), ElementStyle.NoStyle);
      style_substitution_highlights(
        unwrap(replaced_parts[replaced_parts.length - 1]),
        ElementStyle.Removal,
        row_num.value - 1,
        last_line.line,
        max_line_num_len,
        buffer,
      );

      if (str_trim(line_to_add).is_empty()) {
        row_num.value -= 1;
      } else {
        // Check if after the removal, the line is left with only whitespace. If so, we
        // will not show an "addition" line, as removing the whole line is what the user
        // would really want.
        // For example, for the following:
        //   |
        // 2 -     .await
        // 2 +     (note the left over whitespace)
        //   |
        // We really want
        //   |
        // 2 -     .await
        //   |
        // *row_num -= 1;
        buffer.puts(row_num.value, 0, maybe_anonymized(renderer, line_num, max_line_num_len), ElementStyle.LineNumber);
        buffer.puts(row_num.value, max_line_num_len + 1, "+ ", ElementStyle.Addition);
        buffer.append(row_num.value, normalize_whitespace(line_to_add.toString()), ElementStyle.NoStyle);
      }
    }
  } else if (is_multiline) {
    buffer.puts(row_num.value, 0, maybe_anonymized(renderer, line_num, max_line_num_len), ElementStyle.LineNumber);
    if (highlight_parts.length === 1 && highlight_parts[0]!.start === 0 && highlight_parts[0]!.end === line_to_add.len()) {
      buffer.puts(row_num.value, max_line_num_len + 1, "+ ", ElementStyle.Addition);
    } else if (highlight_parts.length === 0 || (highlight_parts.length === 1 && highlight_parts[0]!.start === 0 && highlight_parts[0]!.end === 0)) {
      // FIXME: needed? Doesn't get exercised in any test.
      draw_col_separator_no_space(renderer, buffer, row_num.value, max_line_num_len + 1);
    } else {
      const diff = DecorStyle.diff(renderer.decor_style);
      buffer.puts(row_num.value, max_line_num_len + 1, `${String.fromCodePoint(diff)} `, ElementStyle.Addition);
    }
    //   LL | line_to_add
    //   ++^^^
    //    |  |
    //    |  magic `3`
    //    `max_line_num_len`
    buffer.puts(row_num.value, max_line_num_len + 3, normalize_whitespace(line_to_add.toString()), ElementStyle.NoStyle);
  } else if (show_code_change === "Add") {
    buffer.puts(row_num.value, 0, maybe_anonymized(renderer, line_num, max_line_num_len), ElementStyle.LineNumber);
    buffer.puts(row_num.value, max_line_num_len + 1, "+ ", ElementStyle.Addition);
    buffer.append(row_num.value, normalize_whitespace(line_to_add.toString()), ElementStyle.NoStyle);
  } else {
    buffer.puts(row_num.value, 0, maybe_anonymized(renderer, line_num, max_line_num_len), ElementStyle.LineNumber);
    draw_col_separator(renderer, buffer, row_num.value, max_line_num_len + 1);
    buffer.append(row_num.value, normalize_whitespace(line_to_add.toString()), ElementStyle.NoStyle);
  }

  style_substitution_highlights(highlight_parts, ElementStyle.Addition, row_num.value, line_to_add, max_line_num_len, buffer);

  row_num.value += 1;
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:1923 style_substitution_highlights
function style_substitution_highlights(
  highlight_parts: readonly SubstitutionHighlight[],
  style: ElementStyle,
  row_num: number,
  unnormalized_line: Str,
  max_line_num_len: number,
  buffer: StyledBuffer,
): void {
  for (const { start, end } of highlight_parts) {
    // This is a no-op for empty ranges
    if (start !== end) {
      // We calculate the extra width from tabs for both the start and end
      // of the span, as tabs could be present in the middle of the span
      const extra_width_start = extra_width_from_tabs(unnormalized_line, start);
      const extra_width_end = extra_width_from_tabs(unnormalized_line, end);
      // PORT: `start`/`end` may be wrapped usizes in signed view (overlapping patches, see
      // SubstitutionHighlight); the sums below wrap modulo 2^64 exactly like the release build.
      // `set_style_range` loops `col_start..col_end` in usize order and `set_style` ignores
      // columns past the end of the line, so: a col_start >= 2^63 styles nothing, and a
      // col_end >= 2^63 (where Rust would spin through ~2^64 no-op columns) is clamped to the
      // line length.
      const col_start = max_line_num_len + 3 + start + extra_width_start;
      let col_end = max_line_num_len + 3 + end + extra_width_end;
      if (col_start < 0) continue;
      if (col_end < 0) col_end = Math.max(col_start, buffer.lines[row_num]?.length ?? 0);
      buffer.set_style_range(row_num, col_start, col_end, style, true);
    }
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:1950 draw_line
function draw_line(
  renderer: Renderer,
  buffer: StyledBuffer,
  source_string: string,
  line_index: number,
  line_offset: number,
  width_offset: number,
  code_offset: number,
  max_line_num_len: number,
  margin: Margin,
): number {
  // Tabs are assumed to have been replaced by spaces in calling code.
  // debug_assert!(!source_string.contains('\t'));
  const line_len = str_width(source_string);
  // Create the source line we will highlight.
  let left = margin.left(line_len);
  const right = margin.right(line_len);

  let taken = 0;
  let skipped = 0;
  // PORT: `code: String` is kept as its chars; `&code[bytes_taken..]` skips the chars whose UTF-8
  // lengths sum to `bytes_taken` (always a char boundary: it is built from whole chars).
  const code: number[] = [];
  {
    let skipping = true;
    for (const s of source_string) {
      const ch = s.codePointAt(0)!;
      if (skipping) {
        const w = char_width(ch);
        // If `skipped` is less than `left`, always skip the next `ch`,
        // even if `ch` is a multi-width char that would make `skipped`
        // exceed `left`. This ensures that we do not exceed term width on
        // source lines.
        if (skipped < left) {
          skipped += w;
          continue;
        } else {
          skipping = false;
        }
      }
      // Make sure that the trimming on the right will fall within the terminal width.
      taken += char_width(ch);
      if (!(taken <= right - left)) break;
      code.push(ch);
    }
  }
  // If we skipped more than `left`, adjust `left` to account for it.
  if (skipped > left) {
    left += skipped - left;
  }
  const placeholder = DecorStyle.margin(renderer.decor_style);
  const padding = str_width(placeholder);
  let width_taken: number;
  let bytes_taken: number;
  if (margin.was_cut_left()) {
    // We have stripped some code/whitespace from the beginning, make it clear.
    let bytes_taken_ = 0;
    let width_taken_ = 0;
    for (const ch of code) {
      width_taken_ += char_width(ch);
      bytes_taken_ += len_utf8(ch);

      if (width_taken_ >= padding) {
        break;
      }
    }

    buffer.puts(line_offset, code_offset, placeholder, ElementStyle.LineNumber);
    [width_taken, bytes_taken] = [width_taken_, bytes_taken_];
  } else {
    [width_taken, bytes_taken] = [0, 0];
  }

  // `&code[bytes_taken..]`
  let chars_taken = 0;
  for (let b = 0; b < bytes_taken; chars_taken++) b += len_utf8(code[chars_taken]!);
  const code_rest = code.slice(chars_taken);

  buffer.puts(line_offset, code_offset + width_taken, String.fromCodePoint(...code_rest), ElementStyle.Quotation);

  if (line_len > right) {
    // We have stripped some code/whitespace from the beginning, make it clear.
    let char_taken = 0;
    let width_taken_inner = 0;
    for (let k = code.length - 1; k >= 0; k--) {
      const ch = code[k]!;
      width_taken_inner += char_width(ch);
      char_taken += 1;

      if (width_taken_inner >= padding) {
        break;
      }
    }

    buffer.puts(line_offset, code_offset + width_taken + code_rest.length - char_taken, placeholder, ElementStyle.LineNumber);
  }

  buffer.puts(line_offset, 0, maybe_anonymized(renderer, line_index, max_line_num_len), ElementStyle.LineNumber);

  draw_col_separator_no_space(renderer, buffer, line_offset, width_offset - 2);

  return left;
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2061 draw_range
function draw_range(buffer: StyledBuffer, symbol: number, line: number, col_from: number, col_to: number, style: ElementStyle): void {
  for (let col = col_from; col < col_to; col++) {
    buffer.putc(line, col, symbol, style);
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2074 draw_multiline_line
function draw_multiline_line(renderer: Renderer, buffer: StyledBuffer, line: number, offset: number, depth: number, style: ElementStyle): void {
  let chr: number;
  const primary = style.$ === "UnderlinePrimary" || style.$ === "LabelPrimary";
  if (primary && renderer.decor_style === "Ascii") chr = 0x7c; // '|'
  else if (renderer.decor_style === "Ascii") chr = 0x7c; // '|'
  else if (primary && renderer.decor_style === "Unicode") chr = 0x2503; // '┃'
  else chr = 0x2502; // '│'
  buffer.putc(line, offset + depth - 1, chr, style);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2091 draw_col_separator
function draw_col_separator(renderer: Renderer, buffer: StyledBuffer, line: number, col: number): void {
  const chr = DecorStyle.col_separator(renderer.decor_style);
  buffer.puts(line, col, `${String.fromCodePoint(chr)} `, ElementStyle.LineNumber);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2096 draw_col_separator_no_space
function draw_col_separator_no_space(renderer: Renderer, buffer: StyledBuffer, line: number, col: number): void {
  const chr = DecorStyle.col_separator(renderer.decor_style);
  draw_col_separator_no_space_with_style(buffer, chr, line, col, ElementStyle.LineNumber);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2106 draw_col_separator_start
function draw_col_separator_start(renderer: Renderer, buffer: StyledBuffer, line: number, col: number): void {
  switch (renderer.decor_style) {
    case "Ascii": {
      draw_col_separator_no_space_with_style(buffer, 0x7c /* '|' */, line, col, ElementStyle.LineNumber);
      break;
    }
    case "Unicode": {
      draw_col_separator_no_space_with_style(buffer, 0x256d /* '╭' */, line, col, ElementStyle.LineNumber);
      draw_col_separator_no_space_with_style(buffer, 0x2574 /* '╴' */, line, col + 1, ElementStyle.LineNumber);
      break;
    }
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2141 draw_col_separator_end
function draw_col_separator_end(renderer: Renderer, buffer: StyledBuffer, line: number, col: number): void {
  switch (renderer.decor_style) {
    case "Ascii": {
      draw_col_separator_no_space_with_style(buffer, 0x7c /* '|' */, line, col, ElementStyle.LineNumber);
      break;
    }
    case "Unicode": {
      draw_col_separator_no_space_with_style(buffer, 0x2570 /* '╰' */, line, col, ElementStyle.LineNumber);
      draw_col_separator_no_space_with_style(buffer, 0x2574 /* '╴' */, line, col + 1, ElementStyle.LineNumber);
      break;
    }
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2171 draw_col_separator_no_space_with_style
function draw_col_separator_no_space_with_style(buffer: StyledBuffer, chr: number, line: number, col: number, style: ElementStyle): void {
  buffer.putc(line, col, chr, style);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2181 maybe_anonymized
function maybe_anonymized(renderer: Renderer, line_num: number, max_line_num_len: number): string {
  // format!("{:>max_line_num_len$}", ..): right-aligned, padded with spaces to
  // `max_line_num_len` chars (the value is ASCII, so `.length` counts its chars).
  const s = renderer.anonymized_line_numbers ? ANONYMIZED_LINE_NUM : String(line_num);
  return s.padStart(max_line_num_len, " ");
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2192 draw_note_separator
function draw_note_separator(renderer: Renderer, buffer: StyledBuffer, line: number, col: number, is_cont: boolean): void {
  const chr = DecorStyle.note_separator(renderer.decor_style, is_cont);
  buffer.puts(line, col, chr, ElementStyle.LineNumber);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2203 draw_line_separator
function draw_line_separator(renderer: Renderer, buffer: StyledBuffer, line: number, col: number): void {
  let column: number;
  let dots: string;
  switch (renderer.decor_style) {
    case "Ascii":
      [column, dots] = [0, "..."];
      break;
    case "Unicode":
      [column, dots] = [col - 2, "‡"];
      break;
  }
  buffer.puts(line, column, dots, ElementStyle.LineNumber);
}

// PORT: `trait MessageOrTitle` → an impl table taking `self` first; `&dyn MessageOrTitle` is
// passed as the value plus its table.
interface MessageOrTitle<T> {
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2212 level
  level(self: T): Level;
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2213 id
  id(self: T): Id | undefined;
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2214 text
  text(self: T): string;
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2215 allows_styling
  allows_styling(self: T): boolean;
}

// impl MessageOrTitle for Title<'_>
const MessageOrTitle_for_Title: MessageOrTitle<Title> = {
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2219 level
  level(self: Title): Level {
    return self.level;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2222 id
  id(self: Title): Id | undefined {
    return self.id;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2225 text
  text(self: Title): string {
    return self.text;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2228 allows_styling
  allows_styling(self: Title): boolean {
    return self.allows_styling;
  },
};

// impl MessageOrTitle for Message<'_>
const MessageOrTitle_for_Message: MessageOrTitle<Message> = {
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2234 level
  level(self: Message): Level {
    return self.level;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2237 id
  id(_self: Message): Id | undefined {
    return undefined;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2240 text
  text(self: Message): string {
    return self.text;
  },
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2243 allows_styling
  allows_styling(_self: Message): boolean {
    return true;
  },
};

/// Count extra display columns from tabs in the first `n` chars of `s`.
/// Each tab is displayed as 4 spaces, so the extra width per tab is 3.
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2250 extra_width_from_tabs
function extra_width_from_tabs(s: Str, n: number): number {
  let count = 0;
  const it = s.chars();
  // PORT: `n` may be a usize >= 2^63 in signed view (negative): `take(n)` then takes every char.
  for (let k = 0; n < 0 || k < n; k++) {
    const ch = it.next();
    if (ch === undefined) break;
    if (ch === 0x09 /* '\t' */) count++;
  }
  return count * 3;
}

// instead of taking the String length or dividing by 10 while > 0, we multiply a limit by 10 until
// we're higher. If the loop isn't exited by the `return`, the last multiplication will wrap, which
// is OK, because while we cannot fit a higher power of 10 in a usize, the loop will end anyway.
// This is also why we need the max number of decimal digits within a `usize`.
// PORT: `#[cfg(target_pointer_width = "64")]` (the oracle host). Every `num` here is < 2^53, so the
// loop returns by `num_digits = 16` (lim = 10^16, exact in an f64) and never reaches the
// `wrapping_mul` overflow.
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2258 num_decimal_digits
function num_decimal_digits(num: number): number {
  const MAX_DIGITS = 20;

  let lim = 10;
  for (let num_digits = 1; num_digits < MAX_DIGITS; num_digits++) {
    if (num < lim) {
      return num_digits;
    }
    lim = lim * 10;
  }
  return MAX_DIGITS;
}

// PORT: takes `&str` as either a JS string or a `Str` (both iterated by char).
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2278 str_width
function str_width(s: string | Str): number {
  let w = 0;
  if (typeof s === "string") {
    for (const c of s) w += char_width(c.codePointAt(0)!);
  } else {
    const it = s.chars();
    for (let c = it.next(); c !== undefined; c = it.next()) w += char_width(c);
  }
  return w;
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2282 char_width
export function char_width(ch: number): number {
  // FIXME: `unicode_width` sometimes disagrees with terminals on how wide a `char` is. For now,
  // just accept that sometimes the code line will be longer than desired.
  switch (ch) {
    case 0x09: // '\t'
      return 4;
    // Keep the following list in sync with `rustc_errors::emitter::OUTPUT_REPLACEMENTS`. These
    // are control points that we replace before printing with a visible codepoint for the sake
    // of being able to point at them with underlines.
    case 0x0000:
    case 0x0001:
    case 0x0002:
    case 0x0003:
    case 0x0004:
    case 0x0005:
    case 0x0006:
    case 0x0007:
    case 0x0008:
    case 0x000b:
    case 0x000c:
    case 0x000d:
    case 0x000e:
    case 0x000f:
    case 0x0010:
    case 0x0011:
    case 0x0012:
    case 0x0013:
    case 0x0014:
    case 0x0015:
    case 0x0016:
    case 0x0017:
    case 0x0018:
    case 0x0019:
    case 0x001a:
    case 0x001b:
    case 0x001c:
    case 0x001d:
    case 0x001e:
    case 0x001f:
    case 0x007f:
    case 0x202a:
    case 0x202b:
    case 0x202d:
    case 0x202e:
    case 0x2066:
    case 0x2067:
    case 0x2068:
    case 0x202c:
    case 0x2069:
      return 1;
    default:
      return UnicodeWidthChar.width(ch) ?? 1;
  }
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2301 num_overlap
export function num_overlap(a_start: number, a_end: number, b_start: number, b_end: number, inclusive: boolean): boolean {
  const extra = inclusive ? 1 : 0;
  return (b_start <= a_start && a_start < b_end + extra) || (a_start <= b_start && b_start < a_end + extra);
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2312 overlaps
function overlaps(a1: LineAnnotation, a2: LineAnnotation, padding: number): boolean {
  return num_overlap(a1.start.display, a1.end.display + padding, a2.start.display, a2.end.display, false);
}

export type LineAnnotationType =
  /// Annotation under a single line of code
  | { readonly $: "Singleline" }

  // The Multiline type above is replaced with the following three in order
  // to reuse the current label drawing code.
  //
  // Each of these corresponds to one part of the following diagram:
  //
  //     x |   foo(1 + bar(x,
  //       |  _________^              < MultilineStart
  //     x | |             y),        < MultilineLine
  //       | |______________^ label   < MultilineEnd
  //     x |       z);
  /// Annotation marking the first character of a fully shown multiline span
  | { readonly $: "MultilineStart"; readonly _0: number }
  /// Annotation marking the last character of a fully shown multiline span
  | { readonly $: "MultilineEnd"; readonly _0: number }
  /// Line at the left enclosing the lines of a fully shown multiline span
  // Just a placeholder for the drawing algorithm, to know that it shouldn't skip the first 4
  // and last 2 lines of code. The actual line is drawn in `emit_message_default` and not in
  // `draw_multiline_line`.
  | { readonly $: "MultilineLine"; readonly _0: number };

export const LineAnnotationType = {
  Singleline: Object.freeze({ $: "Singleline" }) as LineAnnotationType,
} as const;

export const debug_LineAnnotationType: Debug<LineAnnotationType> = (v, f) =>
  v.$ === "Singleline" ? "Singleline" : debug_tuple(f, v.$, [String(v._0)]);

export class LineAnnotation {
  constructor(
    /// Start column.
    /// Note that it is important that this field goes
    /// first, so that when we sort, we sort orderings by start
    /// column.
    public start: Loc,
    /// End column within the line (exclusive)
    public end: Loc,
    /// level
    public kind: AnnotationKind,
    /// Optional label to display adjacent to the annotation.
    public label: string | undefined,
    /// Is this a single line, multiline or multiline span minimized down to a
    /// smaller span.
    public annotation_type: LineAnnotationType,
    /// Whether the source code should be highlighted
    public highlight_source: boolean,
  ) {}

  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2374 is_primary
  is_primary(): boolean {
    return this.kind === "Primary";
  }

  /// Whether this annotation is a vertical line placeholder.
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2379 is_line
  is_line(): boolean {
    return this.annotation_type.$ === "MultilineLine";
  }

  /// Length of this annotation as displayed in the stderr output
  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2384 len
  len(): number {
    // Account for usize underflows
    return Math.abs(this.end.display - this.start.display);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2389 has_label
  has_label(): boolean {
    if (this.label !== undefined) {
      // Consider labels with no text as effectively not being there
      // to avoid weird output with unnecessary vertical lines, like:
      //
      //     X | fn foo(x: u32) {
      //       | -------^------
      //       | |      |
      //       | |
      //       |
      //
      // Note that this would be the complete output users would see.
      return !(this.label.length === 0);
    } else {
      return false;
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2407 takes_space
  takes_space(): boolean {
    // Multiline annotations always have to keep vertical space.
    return this.annotation_type.$ === "MultilineStart" || this.annotation_type.$ === "MultilineEnd";
  }
}

export const debug_LineAnnotation: Debug<LineAnnotation> = (v, f) =>
  debug_struct(f, "LineAnnotation", [
    ["start", debug_Loc(v.start, f)],
    ["end", debug_Loc(v.end, f)],
    ["kind", debug_AnnotationKind(v.kind, f)],
    ["label", debug_option(v.label, f, (s: string) => debug_str(s))],
    ["annotation_type", debug_LineAnnotationType(v.annotation_type, f)],
    ["highlight_source", debug_bool(v.highlight_source, f)],
  ]);

export type DisplaySuggestion = "Underline" | "Diff" | "None" | "Add";

export const DisplaySuggestion = {
  Underline: "Underline",
  Diff: "Diff",
  None: "None",
  Add: "Add",

  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2425 new
  new(complete: Str, patches: readonly TrimmedPatch[], sm: SourceMap): DisplaySuggestion {
    const has_deletion = patches.some((p) => p.is_deletion(sm) || p.is_destructive_replacement(sm));
    const is_multiline = Lines.new(complete).count() > 1;
    if (has_deletion && !is_multiline) {
      return "Diff";
    } else if (
      patches.length === 1 &&
      patches[0] !== undefined &&
      ((p) => p.replacement.len() > 0 && p.replacement.byte(p.replacement.len() - 1) === 0x0a && str_eq(str_trim(p.replacement), str_trim(complete)))(
        patches[0],
      )
    ) {
      // We are adding a line(s) of code before code that was already there.
      return "Add";
    } else if ((patches.length !== 1 || !str_eq(str_trim(index(patches, 0).replacement), str_trim(complete))) && !is_multiline) {
      return "Underline";
    } else {
      return "None";
    }
  },
} as const;

export const debug_DisplaySuggestion: Debug<DisplaySuggestion> = (v) => v;

// We replace some characters so the CLI output is always consistent and underlines aligned.
// Keep the following list in sync with `rustc_span::char_width`.
const OUTPUT_REPLACEMENTS: readonly (readonly [number, string])[] = [
  // In terminals without Unicode support the following will be garbled, but in *all* terminals
  // the underlying codepoint will be as well. We could gate this replacement behind a "unicode
  // support" gate.
  [0x0000, "␀"],
  [0x0001, "␁"],
  [0x0002, "␂"],
  [0x0003, "␃"],
  [0x0004, "␄"],
  [0x0005, "␅"],
  [0x0006, "␆"],
  [0x0007, "␇"],
  [0x0008, "␈"],
  [0x0009, "    "], // We do our own tab replacement
  [0x000b, "␋"],
  [0x000c, "␌"],
  [0x000d, "␍"],
  [0x000e, "␎"],
  [0x000f, "␏"],
  [0x0010, "␐"],
  [0x0011, "␑"],
  [0x0012, "␒"],
  [0x0013, "␓"],
  [0x0014, "␔"],
  [0x0015, "␕"],
  [0x0016, "␖"],
  [0x0017, "␗"],
  [0x0018, "␘"],
  [0x0019, "␙"],
  [0x001a, "␚"],
  [0x001b, "␛"],
  [0x001c, "␜"],
  [0x001d, "␝"],
  [0x001e, "␞"],
  [0x001f, "␟"],
  [0x007f, "␡"],
  [0x200d, ""], // Replace ZWJ for consistent terminal output of grapheme clusters.
  [0x202a, "�"], // The following unicode text flow control characters are inconsistently
  [0x202b, "�"], // supported across CLIs and can cause confusion due to the bytes on disk
  [0x202c, "�"], // not corresponding to the visible source code, so we replace them always.
  [0x202d, "�"],
  [0x202e, "�"],
  [0x2066, "�"],
  [0x2067, "�"],
  [0x2068, "�"],
  [0x2069, "�"],
];

/** For the inline tests (render.test.ts). */
export const OUTPUT_REPLACEMENTS_for_test = OUTPUT_REPLACEMENTS;

/** `slice.binary_search_by_key(&c, |(k, _)| *k)` → the index when found. */
function binary_search_replacement(c: number): number | undefined {
  let size = OUTPUT_REPLACEMENTS.length;
  let base = 0;
  // PORT: std's branchless binary search; the table has no duplicate keys, so any found index
  // is the only match.
  while (size > 1) {
    const half = size >>> 1;
    const mid = base + half;
    if (OUTPUT_REPLACEMENTS[mid]![0] <= c) base = mid;
    size -= half;
  }
  return OUTPUT_REPLACEMENTS[base]![0] === c ? base : undefined;
}

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2499 normalize_whitespace
export function normalize_whitespace(s: string): string {
  // Scan the input string for a character in the ordered table above.
  // If it's present, replace it with its alternative string (it can be more than 1 char!).
  // Otherwise, retain the input char.
  let out = "";
  for (const c of s) {
    const i = binary_search_replacement(c.codePointAt(0)!);
    if (i !== undefined) out += OUTPUT_REPLACEMENTS[i]![1];
    else out += c;
  }
  return out;
}

export type ElementStyle =
  | { readonly $: "MainHeaderMsg" }
  | { readonly $: "HeaderMsg" }
  | { readonly $: "LineAndColumn" }
  | { readonly $: "LineNumber" }
  | { readonly $: "Quotation" }
  | { readonly $: "UnderlinePrimary" }
  | { readonly $: "UnderlineSecondary" }
  | { readonly $: "LabelPrimary" }
  | { readonly $: "LabelSecondary" }
  | { readonly $: "NoStyle" }
  | { readonly $: "Level"; readonly _0: LevelInner }
  | { readonly $: "Addition" }
  | { readonly $: "Removal" };

const unit = <T extends ElementStyle["$"]>($: T) => Object.freeze({ $ }) as Extract<ElementStyle, { $: T }>;

export const ElementStyle = {
  MainHeaderMsg: unit("MainHeaderMsg"),
  HeaderMsg: unit("HeaderMsg"),
  LineAndColumn: unit("LineAndColumn"),
  LineNumber: unit("LineNumber"),
  Quotation: unit("Quotation"),
  UnderlinePrimary: unit("UnderlinePrimary"),
  UnderlineSecondary: unit("UnderlineSecondary"),
  LabelPrimary: unit("LabelPrimary"),
  LabelSecondary: unit("LabelSecondary"),
  NoStyle: unit("NoStyle"),
  Addition: unit("Addition"),
  Removal: unit("Removal"),

  // crate: annotate-snippets-0.12.16/src/renderer/render.rs:2530 color_spec
  color_spec(self: ElementStyle, level: Level, stylesheet: Stylesheet): Style {
    switch (self.$) {
      case "Addition":
        return stylesheet.addition;
      case "Removal":
        return stylesheet.removal;
      case "LineAndColumn":
        return stylesheet.none;
      case "LineNumber":
        return stylesheet.line_num;
      case "Quotation":
        return stylesheet.none;
      case "MainHeaderMsg":
        return stylesheet.emphasis;
      case "UnderlinePrimary":
      case "LabelPrimary":
        return level.style(stylesheet);
      case "UnderlineSecondary":
      case "LabelSecondary":
        return stylesheet.context;
      case "HeaderMsg":
      case "NoStyle":
        return stylesheet.none;
      case "Level":
        return LevelInner.style(self._0, stylesheet);
    }
  },
} as const;

export const debug_ElementStyle: Debug<ElementStyle> = (v, f) => (v.$ === "Level" ? debug_tuple(f, "Level", [debug_LevelInner(v._0, f)]) : v.$);

export interface UnderlineParts {
  readonly style: ElementStyle;
  readonly underline: number;
  readonly label_start: number;
  readonly vertical_text_line: number;
  readonly multiline_vertical: number;
  readonly multiline_horizontal: number;
  readonly multiline_whole_line: number;
  readonly multiline_start_down: number;
  readonly bottom_right: number;
  readonly top_left: number;
  readonly top_right_flat: number;
  readonly bottom_left: number;
  readonly multiline_end_up: number;
  readonly multiline_end_same_line: number;
  readonly multiline_bottom_right_with_text: number;
}

export const debug_UnderlineParts: Debug<UnderlineParts> = (v, f) =>
  debug_struct(f, "UnderlineParts", [
    ["style", debug_ElementStyle(v.style, f)],
    ["underline", debug_char(v.underline)],
    ["label_start", debug_char(v.label_start)],
    ["vertical_text_line", debug_char(v.vertical_text_line)],
    ["multiline_vertical", debug_char(v.multiline_vertical)],
    ["multiline_horizontal", debug_char(v.multiline_horizontal)],
    ["multiline_whole_line", debug_char(v.multiline_whole_line)],
    ["multiline_start_down", debug_char(v.multiline_start_down)],
    ["bottom_right", debug_char(v.bottom_right)],
    ["top_left", debug_char(v.top_left)],
    ["top_right_flat", debug_char(v.top_right_flat)],
    ["bottom_left", debug_char(v.bottom_left)],
    ["multiline_end_up", debug_char(v.multiline_end_up)],
    ["multiline_end_same_line", debug_char(v.multiline_end_same_line)],
    ["multiline_bottom_right_with_text", debug_char(v.multiline_bottom_right_with_text)],
  ]);

type TitleStyle = "MainHeader" | "Header" | "Secondary";

interface PreProcessedGroup {
  readonly group: Group;
  readonly elements: PreProcessedElement[];
  readonly primary_path: string | undefined;
  readonly max_depth: number;
}

type PreProcessedElement =
  | { readonly $: "Message"; readonly _0: Message }
  | { readonly $: "Cause"; readonly _0: [Snippet<Annotation>, SourceMap, AnnotatedLineInfo[]] }
  | { readonly $: "Suggestion"; readonly _0: [Snippet<Patch>, SourceMap, SplicedLines, DisplaySuggestion] }
  | { readonly $: "Origin"; readonly _0: Origin }
  | { readonly $: "Padding"; readonly _0: Padding };

// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2600 pre_process
function pre_process(groups: readonly Group[]): [number, string | undefined, PreProcessedGroup[]] {
  let max_line_num = 0;
  let og_primary_path: string | undefined = undefined;
  const out: PreProcessedGroup[] = [];
  for (const group of groups) {
    const elements: PreProcessedElement[] = [];
    let primary_path: OptionPath = undefined;
    let max_depth = 0;
    for (const element of group.elements) {
      switch (element.$) {
        case "Message": {
          const message = element._0;
          elements.push({ $: "Message", _0: message });
          break;
        }
        case "Cause": {
          const cause = element._0;
          const sm = SourceMap.new(cause.source, cause.line_start);
          const [depth, annotated_lines] = sm.annotated_lines(cause.markers, cause.fold);

          if (cause.fold) {
            let end_: number | undefined = undefined;
            for (const a of cause.markers) if (end_ === undefined || a.span.end >= end_) end_ = a.span.end;
            const end = Math.min(end_ ?? cause.source.len(), cause.source.len());

            max_line_num = Math.max(cause.line_start + newline_count(cause.source.slice(0, end)), max_line_num);
          } else {
            max_line_num = Math.max(cause.line_start + newline_count(cause.source), max_line_num);
          }

          if (primary_path === undefined) {
            primary_path = { $: "Some", _0: cause.path };
          }
          max_depth = Math.max(depth, max_depth);
          elements.push({ $: "Cause", _0: [cause, sm, annotated_lines] });
          break;
        }
        case "Suggestion": {
          const suggestion = element._0;
          const sm = SourceMap.new(suggestion.source, suggestion.line_start);
          const spliced = sm.splice_lines(suggestion.markers, suggestion.fold);
          if (spliced !== undefined) {
            const [complete, patches, highlights, replaced_highlights] = spliced;
            const display_suggestion = DisplaySuggestion.new(complete, patches, sm);

            if (suggestion.fold) {
              const first = patches[0];
              if (first !== undefined) {
                const [l_start, _] = sm.span_to_locations(first.original_span);
                const nc = newline_count(complete);
                let sugg_max_line_num: number;
                switch (display_suggestion) {
                  case "Underline":
                    sugg_max_line_num = l_start.line;
                    break;
                  case "Diff": {
                    const file_lines = sm.span_to_lines(first.span);
                    const last = file_lines[file_lines.length - 1];
                    sugg_max_line_num = last === undefined ? l_start.line + nc : last.line_index;
                    break;
                  }
                  case "None":
                    sugg_max_line_num = l_start.line + nc;
                    break;
                  case "Add":
                    sugg_max_line_num = l_start.line + nc;
                    break;
                }
                max_line_num = Math.max(sugg_max_line_num, max_line_num);
              }
            } else {
              max_line_num = Math.max(suggestion.line_start + newline_count(complete), max_line_num);
            }

            elements.push({
              $: "Suggestion",
              _0: [suggestion, sm, [complete, patches, highlights, replaced_highlights], display_suggestion],
            });
          }
          break;
        }
        case "Origin": {
          const origin = element._0;
          if (primary_path === undefined) {
            primary_path = { $: "Some", _0: origin.path };
          }
          elements.push({ $: "Origin", _0: origin });
          break;
        }
        case "Padding": {
          const padding = element._0;
          elements.push({ $: "Padding", _0: padding });
          break;
        }
      }
    }
    const group_: PreProcessedGroup = {
      group,
      elements,
      primary_path: primary_path === undefined ? undefined : primary_path._0, // unwrap_or_default()
      max_depth,
    };
    if (og_primary_path === undefined && group_.primary_path !== undefined) {
      og_primary_path = group_.primary_path;
    }
    out.push(group_);
  }

  return [max_line_num, og_primary_path, out];
}

// PORT: rustc enables the `simd` feature, so this is the `memchr` arm. The
// `#[cfg(not(feature = "simd"))]` arm (`body.lines().count().saturating_sub(1)`) is not compiled.
// crate: annotate-snippets-0.12.16/src/renderer/render.rs:2712 newline_count
export function newline_count(body: Str): number {
  return str_count_byte(body, 0x0a /* b'\n' */);
}
