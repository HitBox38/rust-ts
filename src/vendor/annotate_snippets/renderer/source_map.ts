// Port of annotate-snippets =0.12.16 `src/renderer/source_map.rs`.
//
// PORT: text. The source, its lines (`LineInfo::line`, `AnnotatedLineInfo::line`), patch
// replacements and the spliced output (`SplicedLines.0`) are byte-indexed → `Str`. Labels stay
// JS strings.
// PORT: `Loc` (and `Range`) are `Copy` values → readonly objects. Where upstream assigns to a field
// of a `Loc` local, the port rebinds the local to a modified copy, so a `Loc` object may be shared
// freely (`span_to_locations` returns the same object twice for an empty span).
// PORT: `Vec<T>` parameters taken by value (`annotated_lines`, `splice_lines`) are not modified:
// `splice_lines` sorts its own copy.

import { len_utf8 } from "../../../std/char.ts";
import { debug_bool, debug_option, debug_struct, debug_vec, PLAIN, type Debug } from "../../../std/fmt.ts";
import { panic, unwrap } from "../../../std/panic.ts";
import { Str } from "../../../std/str.ts";
import { AnnotationKind, debug_AnnotationKind, Patch, type Annotation } from "../snippet.ts";
import {
  debug_Range,
  debug_Str,
  debug_string,
  index,
  isize_as_usize,
  usize_display,
  range_is_empty,
  saturating_sub,
  str_char_count,
  str_count_byte,
  str_eq,
  str_get,
  str_nth_char_index,
  str_split_byte,
  str_strip_prefix,
  str_strip_suffix,
  str_trim,
  usize_wrapping_sub,
  type Range,
} from "../std_ext.ts";
import { char_width, debug_LineAnnotation, LineAnnotation, LineAnnotationType, num_overlap } from "./render.ts";

const EMPTY: Str = Str.from("");

export class SourceMap {
  constructor(
    public lines: LineInfo[],
    public source: Str,
  ) {}

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:17 new
  static new(source: Str, line_start: number): SourceMap {
    // Empty sources do have a "line", but it is empty, so we need to add
    // a line with an empty string to the source map.
    if (source.is_empty()) {
      return new SourceMap(
        [
          {
            line: EMPTY,
            line_index: line_start,
            start_byte: 0,
            end_byte: 0,
            end_line_size: 0,
          },
        ],
        source,
      );
    }

    let current_index = 0;

    const mapping: LineInfo[] = [];
    const lines = CursorLines.new(source);
    for (let idx = 0, item = lines.next(); item !== undefined; idx++, item = lines.next()) {
      const [line, end_line] = item;
      const line_length = line.len();
      const line_range: Range = { start: current_index, end: current_index + line_length };
      const end_line_size = EndLine.len(end_line);

      mapping.push({
        line,
        line_index: line_start + idx,
        start_byte: line_range.start,
        end_byte: line_range.end + end_line_size,
        end_line_size,
      });

      current_index += line_length + end_line_size;
    }
    return new SourceMap(mapping, source);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:57 get_line
  get_line(idx: number): Str | undefined {
    return this.lines.find((l) => l.line_index === idx)?.line;
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:64 span_to_locations
  span_to_locations(span: Range): [Loc, Loc] {
    const last = unwrap(this.lines[this.lines.length - 1]); // evaluated eagerly by `unwrap_or`
    const start_info = this.lines.find((info) => span.start >= info.start_byte && span.start < info.end_byte) ?? last;
    let start_char_pos = 0;
    let start_display_pos = 0;
    {
      const chars = start_info.line.slice(0, Math.min(usize_wrapping_sub(span.start, start_info.start_byte), start_info.line.len())).chars();
      for (let c = chars.next(); c !== undefined; c = chars.next()) {
        const display = char_width(c);
        start_char_pos += 1;
        start_display_pos += display;
      }
    }
    // correct the char pos if we are highlighting the end of a line
    if (saturating_sub(usize_wrapping_sub(span.start, start_info.start_byte), start_info.line.len()) > 0) {
      start_char_pos += 1;
    }
    const start: Loc = {
      line: start_info.line_index,
      char: start_char_pos,
      display: start_display_pos,
      byte: span.start,
    };

    if (span.start === span.end) {
      return [start, start];
    }

    const last_ = unwrap(this.lines[this.lines.length - 1]); // evaluated eagerly by `unwrap_or`
    const end_info = this.lines.find((info) => span.end >= info.start_byte && span.end < info.end_byte) ?? last_;
    let end_char_pos = 0;
    let end_display_pos = 0;
    {
      const chars = end_info.line.slice(0, Math.min(usize_wrapping_sub(span.end, end_info.start_byte), end_info.line.len())).chars();
      for (let c = chars.next(); c !== undefined; c = chars.next()) {
        const display = char_width(c);
        end_char_pos += 1;
        end_display_pos += display;
      }
    }

    let end: Loc = {
      line: end_info.line_index,
      char: end_char_pos,
      display: end_display_pos,
      byte: span.end,
    };
    if (start.line !== end.line && end.byte > end_info.end_byte - end_info.end_line_size) {
      end = { ...end, char: end.char + 1, display: end.display + 1 };
    }

    return [start, end];
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:119 span_to_snippet
  span_to_snippet(span: Range): Str | undefined {
    return str_get(this.source, span.start, span.end);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:123 span_to_lines
  span_to_lines(span: Range): LineInfo[] {
    const lines: LineInfo[] = [];
    const start = span.start;
    const end = span.end;
    for (const line_info of this.lines) {
      if (start >= line_info.end_byte) {
        continue;
      }
      if (end < line_info.start_byte) {
        break;
      }
      lines.push(line_info);
    }

    if (lines.length === 0 && this.lines.length !== 0) {
      lines.push(this.lines[this.lines.length - 1]!);
    }

    return lines;
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:144 annotated_lines
  annotated_lines(annotations: readonly Annotation[], fold: boolean): [number, AnnotatedLineInfo[]] {
    const source_len = this.source.len();
    let bigger: Range | undefined;
    for (const x of annotations) {
      // Allow highlighting one past the last character in the source.
      if (source_len + 1 < x.span.end) {
        bigger = x.span;
        break;
      }
    }
    if (bigger !== undefined) {
      panic(`Annotation range \`${debug_Range(bigger, PLAIN)}\` is beyond the end of buffer \`${source_len}\``);
    }

    let annotated_line_infos: AnnotatedLineInfo[] = this.lines.map((info) => ({
      line: info.line,
      line_index: info.line_index,
      annotations: [],
      keep: false,
    }));
    const multiline_annotations: MultilineAnnotation[] = [];

    for (const { span, label, kind, highlight_source } of annotations) {
      const [lo, hi_] = this.span_to_locations(span);
      let hi = hi_;
      if (kind === AnnotationKind.Visible) {
        for (let line_idx = lo.line; line_idx <= hi.line; line_idx++) {
          this.keep_line(annotated_line_infos, line_idx);
        }
        continue;
      }
      // Watch out for "empty spans". If we get a span like 6..6, we
      // want to just display a `^` at 6, so convert that to
      // 6..7. This is degenerate input, but it's best to degrade
      // gracefully -- and the parser likes to supply a span like
      // that for EOF, in particular.

      if (lo.display === hi.display && lo.line === hi.line) {
        hi = { ...hi, display: hi.display + 1 };
      }

      if (lo.line === hi.line) {
        const line_ann = new LineAnnotation(lo, hi, kind, label, LineAnnotationType.Singleline, highlight_source);
        this.add_annotation_to_file(annotated_line_infos, lo.line, line_ann);
      } else {
        multiline_annotations.push(new MultilineAnnotation(1, lo, hi, kind, label, false, highlight_source));
      }
    }

    const primary_spans: [Loc, Loc][] = [];

    // Find overlapping multiline annotations, put them at different depths
    // sort_by_key(|ml| (ml.start.line, usize::MAX - ml.end.line)); `Array.prototype.sort` is stable.
    multiline_annotations.sort((a, b) => a.start.line - b.start.line || b.end.line - a.end.line);
    // multiline_annotations.clone()
    const snapshot = multiline_annotations.map(
      (a) => new MultilineAnnotation(a.depth, a.start, a.end, a.kind, a.label, a.overlaps_exactly, a.highlight_source),
    );
    for (let outer_i = 0; outer_i < snapshot.length; outer_i++) {
      const ann = snapshot[outer_i]!;
      if (AnnotationKind.is_primary(ann.kind)) {
        primary_spans.push([ann.start, ann.end]);
      }
      for (let inner_i = 0; inner_i < multiline_annotations.length; inner_i++) {
        const a = multiline_annotations[inner_i]!;
        // Move all other multiline annotations overlapping with this one
        // one level to the right.
        if (!ann.same_span(a) && num_overlap(ann.start.line, ann.end.line, a.start.line, a.end.line, true)) {
          a.increase_depth();
        } else if (ann.same_span(a) && outer_i !== inner_i) {
          a.overlaps_exactly = true;
        } else {
          if (primary_spans.some(([s, e]) => Loc_eq(a.start, s) && Loc_eq(a.end, e))) {
            a.kind = AnnotationKind.Primary;
          }
          break;
        }
      }
    }

    let max_depth = 0; // max overlapping multiline spans
    for (const ann of multiline_annotations) {
      max_depth = Math.max(max_depth, ann.depth);
    }
    // Change order of multispan depth to minimize the number of overlaps in the ASCII art.
    for (const a of multiline_annotations) {
      a.depth = max_depth - a.depth + 1;
    }
    for (const ann of multiline_annotations) {
      const end_ann = ann.as_end();
      if (ann.overlaps_exactly) {
        end_ann.annotation_type = LineAnnotationType.Singleline;
      } else {
        // avoid output like
        //
        //  |        foo(
        //  |   _____^
        //  |  |_____|
        //  | ||         bar,
        //  | ||     );
        //  | ||      ^
        //  | ||______|
        //  |  |______foo
        //  |         baz
        //
        // and instead get
        //
        //  |       foo(
        //  |  _____^
        //  | |         bar,
        //  | |     );
        //  | |      ^
        //  | |      |
        //  | |______foo
        //  |        baz
        this.add_annotation_to_file(annotated_line_infos, ann.start.line, ann.as_start());
        // 4 is the minimum vertical length of a multiline span when presented: two lines
        // of code and two lines of underline. This is not true for the special case where
        // the beginning doesn't have an underline, but the current logic seems to be
        // working correctly.
        const middle = Math.min(ann.start.line + 4, ann.end.line);
        // We'll show up to 4 lines past the beginning of the multispan start.
        // We will *not* include the tail of lines that are only whitespace, a comment or
        // a bare delimiter.
        const filter = (s_: Str): boolean => {
          const s = str_trim(s_);
          // Consider comments as empty, but don't consider docstrings to be empty.
          return (
            !(s.starts_with("//") && !(s.starts_with("///") || s.starts_with("//!"))) &&
            // Consider lines with nothing but whitespace, a single delimiter as empty.
            !["", "{", "}", "(", ")", "[", "]"].some((x) => str_eq(s, x))
          );
        };
        // (ann.start.line..middle).rev().filter_map(..).find(..).map_or(ann.start.line, ..)
        let until = ann.start.line;
        for (let line = middle - 1; line >= ann.start.line; line--) {
          const s = this.get_line(line);
          if (s !== undefined && filter(s)) {
            until = line + 1;
            break;
          }
        }
        for (let line = ann.start.line + 1; line < until; line++) {
          // Every `|` that joins the beginning of the span (`___^`) to the end (`|__^`).
          this.add_annotation_to_file(annotated_line_infos, line, ann.as_line());
        }
        const line_end = ann.end.line - 1;
        const end_line = this.get_line(line_end);
        const end_is_empty = end_line !== undefined && !filter(end_line);
        if (middle < line_end && !end_is_empty) {
          this.add_annotation_to_file(annotated_line_infos, line_end, ann.as_line());
        }
      }
      this.add_annotation_to_file(annotated_line_infos, end_ann.end.line, end_ann);
    }

    if (fold) {
      annotated_line_infos = annotated_line_infos.filter((l) => l.annotations.length !== 0 || l.keep);
    }

    return [max_depth, annotated_line_infos];
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:329 add_annotation_to_file
  add_annotation_to_file(annotated_line_infos: AnnotatedLineInfo[], line_index: number, line_ann: LineAnnotation): void {
    const line_info = annotated_line_infos.find((line_info) => line_info.line_index === line_index);
    if (line_info !== undefined) {
      line_info.annotations.push(line_ann);
    } else {
      const info = unwrap(this.lines.find((l) => l.line_index === line_index));
      annotated_line_infos.push({
        line: info.line,
        line_index,
        annotations: [line_ann],
        keep: false,
      });
      annotated_line_infos.sort((a, b) => a.line_index - b.line_index);
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:356 keep_line
  keep_line(annotated_line_infos: AnnotatedLineInfo[], line_index: number): void {
    const line_info = annotated_line_infos.find((line_info) => line_info.line_index === line_index);
    if (line_info !== undefined) {
      line_info.keep = true;
    } else {
      const info = unwrap(this.lines.find((l) => l.line_index === line_index));
      annotated_line_infos.push({
        line: info.line,
        line_index,
        annotations: [],
        keep: true,
      });
      annotated_line_infos.sort((a, b) => a.line_index - b.line_index);
    }
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:378 splice_lines
  splice_lines(patches_: readonly Patch[], fold: boolean): SplicedLines | undefined {
    // PORT: `buf: &mut String` → a `{ value }` cell.
    // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:383 push_trailing
    function push_trailing(buf: { value: string }, line_opt: Str | undefined, lo_: Loc, hi_opt_: Loc | undefined): void {
      // Convert CharPos to Usize, as CharPose is character offset
      // Extract low index and high index
      const lo = lo_.char;
      const hi_opt = hi_opt_ === undefined ? undefined : hi_opt_.char;
      if (line_opt !== undefined) {
        const line = line_opt;
        const lo_i = str_nth_char_index(line, lo);
        if (lo_i !== undefined) {
          // Get high index while account for rare unicode and emoji with char_indices
          const hi_i = hi_opt === undefined ? undefined : str_nth_char_index(line, hi_opt);
          if (hi_i !== undefined) {
            // If high index exist, take string from low to high index
            if (hi_i > lo_i) buf.value += line.slice(lo_i, hi_i).toString();
          } else {
            // If high index absence, take string from low index till end string.len
            buf.value += line.slice(lo_i).toString();
          }
        }
        // If high index is None
        if (hi_opt === undefined) {
          buf.value += "\n";
        }
      }
    }

    const source_len = this.source.len();
    let bigger: Range | undefined;
    for (const x of patches_) {
      // Allow patching one past the last character in the source.
      if (source_len + 1 < x.span.end) {
        bigger = x.span;
        break;
      }
    }
    if (bigger !== undefined) {
      panic(`Patch span \`${debug_Range(bigger, PLAIN)}\` is beyond the end of buffer \`${source_len}\``);
    }

    // Assumption: all spans are in the same file, and all spans
    // are disjoint. Sort in ascending order.
    const patches = patches_.slice().sort((a, b) => a.span.start - b.span.start);

    // Find the bounding span.
    let lo: number;
    let hi: number;
    if (fold) {
      if (patches.length === 0) return undefined; // `min()?` / `max()?`
      lo = patches[0]!.span.start;
      hi = patches[0]!.span.end;
      for (const p of patches) {
        lo = Math.min(lo, p.span.start);
        hi = Math.max(hi, p.span.end);
      }
    } else {
      lo = 0;
      hi = source_len;
    }

    const lines = this.span_to_lines({ start: lo, end: hi });

    const highlights: SubstitutionHighlight[][] = [];
    // To build up the result, we do this for each span:
    // - push the line segment trailing the previous span
    //   (at the beginning a "phantom" span pointing at the start of the line)
    // - push lines between the previous and current span (if any)
    // - if the previous and current span are not on the same line
    //   push the line segment leading up to the current span
    // - splice in the span substitution
    //
    // Finally push the trailing line segment of the last span
    let [prev_hi] = this.span_to_locations({ start: lo, end: hi });
    prev_hi = { ...prev_hi, char: 0 };
    let prev_line: Str | undefined = lines[0]?.line;
    const buf = { value: "" };

    const trimmed_patches = patches
      // If this is a replacement of, e.g. `"a"` into `"ab"`, adjust the
      // suggestion and snippet to look as if we just suggested to add
      // `"b"`, which is typically much easier for the user to understand.
      .map((part) => Patch.trim_trivial_replacements(part, this.source));
    let line_highlight: SubstitutionHighlight[] = [];
    // We need to keep track of the difference between the existing code and the added
    // or deleted code in order to point at the correct column *after* substitution.
    let acc = 0;
    for (const part of trimmed_patches) {
      const [cur_lo, cur_hi] = this.span_to_locations(part.span);
      if (prev_hi.line === cur_lo.line) {
        push_trailing(buf, prev_line, prev_hi, cur_lo);
      } else {
        acc = 0;
        highlights.push(line_highlight); // core::mem::take
        line_highlight = [];
        push_trailing(buf, prev_line, prev_hi, undefined);
        // push lines between the previous and current span (if any)
        for (let idx = prev_hi.line + 1; idx < cur_lo.line; idx++) {
          const line = this.get_line(idx);
          if (line !== undefined) {
            buf.value += line.toString();
            buf.value += "\n";
            highlights.push(line_highlight); // core::mem::take
            line_highlight = [];
          }
        }
        const cur_line = this.get_line(cur_lo.line);
        if (cur_line !== undefined) {
          const end = str_nth_char_index(cur_line, cur_lo.char) ?? cur_line.len();
          buf.value += cur_line.slice(0, end).toString();
        }
      }
      // Add a whole line highlight per line in the snippet.
      let len = 0; // isize
      {
        const chars = str_split_byte(part.replacement, 0x0a /* '\n' */)[0]!.chars();
        for (let c = chars.next(); c !== undefined; c = chars.next()) {
          len += c === 0x09 /* '\t' */ ? 4 : 1;
        }
      }
      line_highlight.push({
        start: isize_as_usize(cur_lo.char + acc),
        end: isize_as_usize(cur_lo.char + acc + len),
      });
      buf.value += part.replacement.toString();
      // Account for the difference between the width of the current code and the
      // snippet being suggested, so that the *later* suggestions are correctly
      // aligned on the screen. Note that cur_hi and cur_lo can be on different
      // lines, so cur_hi.col can be smaller than cur_lo.col
      acc += len - (cur_hi.char - cur_lo.char);
      prev_hi = cur_hi;
      prev_line = this.get_line(prev_hi.line);
      for (const line of str_split_byte(part.replacement, 0x0a /* '\n' */).slice(1)) {
        acc = 0;
        highlights.push(line_highlight); // core::mem::take
        line_highlight = [];
        let end = 0;
        const chars = line.chars();
        for (let c = chars.next(); c !== undefined; c = chars.next()) {
          end += c === 0x09 /* '\t' */ ? 4 : 1;
        }
        line_highlight.push({ start: 0, end });
      }
    }
    highlights.push(line_highlight); // core::mem::take
    line_highlight = [];
    if (fold) {
      // if the replacement already ends with a newline, don't print the next line
      if (!buf.value.endsWith("\n")) {
        push_trailing(buf, prev_line, prev_hi, undefined);
      }
    } else {
      // Add the trailing part of the source after the last patch
      const snippet = this.span_to_snippet({ start: prev_hi.byte, end: source_len });
      if (snippet !== undefined) {
        buf.value += snippet.toString();
        for (let i = 0, n = str_count_byte(snippet, 0x0a /* '\n' */); i < n; i++) {
          highlights.push(line_highlight); // core::mem::take
          line_highlight = [];
        }
      }
    }
    // remove trailing newlines
    while (buf.value.endsWith("\n")) {
      buf.value = buf.value.slice(0, -1);
    }

    const [bounding_lo, bounding_hi] = this.span_to_locations({ start: lo, end: hi });
    const line_count = saturating_sub(bounding_hi.line, bounding_lo.line) + 1;
    const replaced_highlights: SubstitutionHighlight[][] = Array.from({ length: line_count }, () => []);
    for (const part of trimmed_patches) {
      const [cur_lo, cur_hi] = this.span_to_locations(part.span);
      for (let line = cur_lo.line; line <= cur_hi.line; line++) {
        const start = line === cur_lo.line ? cur_lo.char : 0;
        const end = line === cur_hi.line ? cur_hi.char : str_char_count(this.get_line(line) ?? EMPTY);
        index(replaced_highlights, usize_wrapping_sub(line, bounding_lo.line)).push({ start, end });
      }
    }

    if (highlights.every((parts) => parts.length === 0)) {
      return undefined;
    } else {
      return [Str.from(buf.value), trimmed_patches, highlights, replaced_highlights];
    }
  }
}

export const debug_SourceMap: Debug<SourceMap> = (v, f) =>
  debug_struct(f, "SourceMap", [
    ["lines", debug_vec(v.lines, f, debug_LineInfo)],
    ["source", debug_Str(v.source, f)],
  ]);

export class MultilineAnnotation {
  constructor(
    public depth: number,
    public start: Loc,
    public end: Loc,
    public kind: AnnotationKind,
    public label: string | undefined,
    public overlaps_exactly: boolean,
    public highlight_source: boolean,
  ) {}

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:577 increase_depth
  increase_depth(): void {
    this.depth += 1;
  }

  /// Compare two `MultilineAnnotation`s considering only the `Span` they cover.
  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:582 same_span
  same_span(other: MultilineAnnotation): boolean {
    return Loc_eq(this.start, other.start) && Loc_eq(this.end, other.end);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:586 as_start
  as_start(): LineAnnotation {
    return new LineAnnotation(
      this.start,
      {
        line: this.start.line,
        char: this.start.char + 1,
        display: this.start.display + 1,
        byte: this.start.byte + 1,
      },
      this.kind,
      undefined,
      { $: "MultilineStart", _0: this.depth },
      this.highlight_source,
    );
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:602 as_end
  as_end(): LineAnnotation {
    return new LineAnnotation(
      {
        line: this.end.line,
        char: saturating_sub(this.end.char, 1),
        display: saturating_sub(this.end.display, 1),
        byte: saturating_sub(this.end.byte, 1),
      },
      this.end,
      this.kind,
      this.label,
      { $: "MultilineEnd", _0: this.depth },
      this.highlight_source,
    );
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:618 as_line
  as_line(): LineAnnotation {
    return new LineAnnotation(Loc_default(), Loc_default(), this.kind, undefined, { $: "MultilineLine", _0: this.depth }, this.highlight_source);
  }
}

export const debug_MultilineAnnotation: Debug<MultilineAnnotation> = (v, f) =>
  debug_struct(f, "MultilineAnnotation", [
    ["depth", String(v.depth)],
    ["start", debug_Loc(v.start, f)],
    ["end", debug_Loc(v.end, f)],
    ["kind", debug_AnnotationKind(v.kind, f)],
    ["label", debug_option(v.label, f, debug_string)],
    ["overlaps_exactly", debug_bool(v.overlaps_exactly, f)],
    ["highlight_source", debug_bool(v.highlight_source, f)],
  ]);

export interface LineInfo {
  readonly line: Str;
  readonly line_index: number;
  readonly start_byte: number;
  readonly end_byte: number;
  readonly end_line_size: number;
}

export const debug_LineInfo: Debug<LineInfo> = (v, f) =>
  debug_struct(f, "LineInfo", [
    ["line", debug_Str(v.line, f)],
    ["line_index", String(v.line_index)],
    ["start_byte", String(v.start_byte)],
    ["end_byte", String(v.end_byte)],
    ["end_line_size", String(v.end_line_size)],
  ]);

export interface AnnotatedLineInfo {
  line: Str;
  line_index: number;
  annotations: LineAnnotation[];
  keep: boolean;
}

export const debug_AnnotatedLineInfo: Debug<AnnotatedLineInfo> = (v, f) =>
  debug_struct(f, "AnnotatedLineInfo", [
    ["line", debug_Str(v.line, f)],
    ["line_index", String(v.line_index)],
    ["annotations", debug_vec(v.annotations, f, debug_LineAnnotation)],
    ["keep", debug_bool(v.keep, f)],
  ]);

/// A source code location used for error reporting.
export interface Loc {
  /// The (1-based) line number.
  readonly line: number;
  /// The (0-based) column offset.
  readonly char: number;
  /// The (0-based) column offset when displayed.
  readonly display: number;
  /// The (0-based) byte offset.
  readonly byte: number;
}

/** `#[derive(Default)] for Loc` */
export function Loc_default(): Loc {
  return { line: 0, char: 0, display: 0, byte: 0 };
}

/** `#[derive(PartialEq)] for Loc` */
export function Loc_eq(a: Loc, b: Loc): boolean {
  return a.line === b.line && a.char === b.char && a.display === b.display && a.byte === b.byte;
}

export const debug_Loc: Debug<Loc> = (v, f) =>
  debug_struct(f, "Loc", [
    ["line", String(v.line)],
    ["char", String(v.char)],
    ["display", String(v.display)],
    ["byte", String(v.byte)],
  ]);

export class CursorLines {
  constructor(public _0: Str) {}

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:663 new
  static new(src: Str): CursorLines {
    return new CursorLines(src);
  }

  // impl<'a> Iterator for CursorLines<'a>
  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:689 next
  next(): [Str, EndLine] | undefined {
    if (this._0.is_empty()) {
      return undefined;
    } else {
      // PORT: `self.0.find('\n')` → byte search for 0x0a.
      let x: number | undefined;
      for (let i = 0; i < this._0.len(); i++) {
        if (this._0.byte(i) === 0x0a) {
          x = i;
          break;
        }
      }
      if (x !== undefined) {
        let ret: [Str, EndLine];
        if (0 < x) {
          if (this._0.byte(x - 1) === 0x0d /* b'\r' */) {
            ret = [this._0.slice(0, x - 1), "Crlf"];
          } else {
            ret = [this._0.slice(0, x), "Lf"];
          }
        } else {
          ret = [EMPTY, "Lf"];
        }
        this._0 = this._0.slice(x + 1);
        return ret;
      } else {
        const ret: [Str, EndLine] = [this._0, "Eof"];
        this._0 = EMPTY;
        return ret;
      }
    }
  }
}

export type EndLine = "Eof" | "Lf" | "Crlf";

export const EndLine = {
  Eof: "Eof",
  Lf: "Lf",
  Crlf: "Crlf",

  /// The number of characters this line ending occupies in bytes.
  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:677 len
  len(self: EndLine): number {
    switch (self) {
      case "Eof":
        return 0;
      case "Lf":
        return 1;
      case "Crlf":
        return 2;
    }
  },
} as const;

export const debug_EndLine: Debug<EndLine> = (v) => v;

export type SplicedLines = [
  Str,
  TrimmedPatch[],
  // Char spans to highlight per line of the post-substitution output.
  SubstitutionHighlight[][],
  // Char spans of the replaced (original) code, per original line in the
  // bounding range covered by the splice.
  SubstitutionHighlight[][],
];

/// Used to translate between `Span`s and byte positions within a single output line in highlighted
/// code of structured suggestions.
// PORT: `start`/`end` are `usize`s that `splice_lines` may produce from a negative `isize`
// (overlapping patches); they are kept in signed view (see `isize_as_usize` in std_ext.ts).
export interface SubstitutionHighlight {
  readonly start: number;
  readonly end: number;
}

export const debug_SubstitutionHighlight: Debug<SubstitutionHighlight> = (v, f) =>
  debug_struct(f, "SubstitutionHighlight", [
    ["start", usize_display(v.start)],
    ["end", usize_display(v.end)],
  ]);

export class TrimmedPatch {
  constructor(
    public original_span: Range,
    public span: Range,
    public replacement: Str,
  ) {}

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:743 is_addition
  is_addition(sm: SourceMap): boolean {
    return !this.replacement.is_empty() && !this.replaces_meaningful_content(sm);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:747 is_deletion
  is_deletion(sm: SourceMap): boolean {
    return str_trim(this.replacement).is_empty() && this.replaces_meaningful_content(sm);
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:751 is_replacement
  is_replacement(sm: SourceMap): boolean {
    return !this.replacement.is_empty() && this.replaces_meaningful_content(sm);
  }

  /// Whether this is a replacement that overwrites source with a snippet
  /// in a way that isn't a superset of the original string. For example,
  /// replacing "abc" with "abcde" is not destructive, but replacing it
  /// it with "abx" is, since the "c" character is lost.
  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:759 is_destructive_replacement
  is_destructive_replacement(sm: SourceMap): boolean {
    if (!this.is_replacement(sm)) return false;
    const s = sm.span_to_snippet(this.span);
    return s === undefined || as_substr(str_trim(s), str_trim(this.replacement)) === undefined;
  }

  // crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:766 replaces_meaningful_content
  replaces_meaningful_content(sm: SourceMap): boolean {
    const snippet = sm.span_to_snippet(this.span);
    return snippet === undefined ? !range_is_empty(this.span) : !str_trim(snippet).is_empty();
  }
}

export const debug_TrimmedPatch: Debug<TrimmedPatch> = (v, f) =>
  debug_struct(f, "TrimmedPatch", [
    ["original_span", debug_Range(v.original_span, f)],
    ["span", debug_Range(v.span, f)],
    ["replacement", debug_Str(v.replacement, f)],
  ]);

/// Given an original string like `AACC`, and a suggestion like `AABBCC`, try to detect
/// the case where a substring of the suggestion is "sandwiched" in the original, like
/// `BB` is. Return the length of the prefix, the "trimmed" suggestion, and the length
/// of the suffix.
// crate: annotate-snippets-0.12.16/src/renderer/source_map.rs:776 as_substr
export function as_substr(original: Str, suggestion: Str): [number, Str, number] | undefined {
  const stripped = str_strip_prefix(suggestion, original);
  if (stripped !== undefined) {
    return [original.len(), stripped, 0];
  }
  const stripped_ = str_strip_suffix(suggestion, original);
  if (stripped_ !== undefined) {
    return [0, stripped_, original.len()];
  } else {
    let common_prefix = 0;
    const a = original.chars();
    const b = suggestion.chars();
    for (;;) {
      const c1 = a.next();
      if (c1 === undefined) break;
      const c2 = b.next();
      if (c2 === undefined || c1 !== c2) break;
      common_prefix += len_utf8(c1);
    }
    const original_ = original.slice(common_prefix);
    const suggestion_ = suggestion.slice(common_prefix);
    const stripped__ = str_strip_suffix(suggestion_, original_);
    if (stripped__ !== undefined) {
      const common_suffix = original_.len();
      return [common_prefix, stripped__, common_suffix];
    } else {
      return undefined;
    }
  }
}
