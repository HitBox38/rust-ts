//! Emit diagnostics using the `annotate-snippets` library
//!
//! This is the equivalent of `./emitter.rs` but making use of the
//! [`annotate-snippets`][annotate_snippets] library instead of building the output ourselves.
//!
//! [annotate_snippets]: https://docs.rs/crate/annotate-snippets/
// Port of compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs.
//
// PORT: representation decisions for this file:
// - `#[derive(Setters)]` (derive_setters 0.1.8: one `pub fn <field>(mut self, value: <FieldType>)
//   -> Self` per field not marked `#[setters(skip)]`) -> static builder functions on the class,
//   `AnnotateSnippetEmitter.sm(self, value)` etc., which set the field and return the same object
//   (static so that the field names stay the upstream ones).
// - `IntoDynSyncSend<Destination>` -> the `Destination` itself.
// - `Arc<SourceMap>` / `Arc<SourceFile>` -> the objects.
// - Iterator chains whose closures only read state are evaluated eagerly in upstream order.
import { DEFAULT_TERM_WIDTH, DecorStyle, Renderer } from "../vendor/annotate_snippets/renderer/mod.ts";
import {
  type Annotation as AsAnnotation,
  Annotation as annotate_snippets_Annotation,
  AnnotationKind,
  Element,
  Group,
  Origin,
  Padding,
  type Patch,
  Patch as PatchC,
  Snippet,
  Title as annotate_snippets_Title,
} from "../vendor/annotate_snippets/snippet.ts";
import * as annotate_snippets from "../vendor/annotate_snippets/level.ts";
import { ColorChoice } from "../vendor/anstream/lib.ts";
import { Style as Anstyle } from "../vendor/anstyle/lib.ts";
import { dimensions as termize_dimensions } from "../vendor/termize/lib.ts";
import type { DiagArgMap, DiagMessage, MultiSpan, SpanLabel } from "../rustc_error_messages/lib.ts";
import { debug_SourceMap, type SourceMap, stable_source_file_id_key } from "../rustc_span/source_map.ts";
import { BytePos, DUMMY_SP, type FileName, type RealFileName, type SourceFile, Span, debug_Span } from "../rustc_span/lib.ts";
import { type Component, path_components } from "../std/path.ts";
import { type Debug, PLAIN, PRETTY, debug_bool, debug_int, debug_option, debug_str, debug_struct, debug_vec } from "../std/fmt.ts";
import { display_IoError, type IoResult } from "../std/io.ts";
import { panic, unported } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import { binary_search_by } from "../std/slice.ts";
import { Str, utf8_len } from "../std/str.ts";
import {
  ConfusionType,
  type Destination,
  Emitter,
  MAX_SUGGESTIONS,
  OutputTheme,
  Style_anstyle,
  debug_OutputTheme,
  detect_confusion_type,
  is_different,
  normalize_whitespace,
  should_show_source_code,
} from "./emitter.ts";
import { format_diag_message, format_diag_messages } from "./formatting.ts";
import { pluralize } from "../rustc_lint_defs/lib.ts";
import * as lock from "./lock.ts";
import type { CodeSuggestion, DiagInner, ErrCode, Style, Subdiag, Sublevel, Substitution, SubstitutionPart, TerminalUrl } from "./lib.ts";
import { Level, Suggestions, debug_TerminalUrl, display_ErrCode, str_trim } from "./lib.ts";

/// Generates diagnostics using annotate-snippet
export class AnnotateSnippetEmitter extends Emitter {
  constructor(
    // #[setters(skip)]
    public dst: Destination,
    public sm: SourceMap | undefined,
    public short_message: boolean,
    public ui_testing: boolean,
    public ignored_directories_in_source_blocks: string[],
    public diagnostic_width: number | undefined,
    public macro_backtrace: boolean,
    public track_diagnostics: boolean,
    public terminal_url: TerminalUrl,
    public theme: OutputTheme,
  ) {
    super();
  }

  // ---- #[derive(Setters)] ----

  static sm(self: AnnotateSnippetEmitter, value: SourceMap | undefined): AnnotateSnippetEmitter {
    self.sm = value;
    return self;
  }
  static short_message(self: AnnotateSnippetEmitter, value: boolean): AnnotateSnippetEmitter {
    self.short_message = value;
    return self;
  }
  static ui_testing(self: AnnotateSnippetEmitter, value: boolean): AnnotateSnippetEmitter {
    self.ui_testing = value;
    return self;
  }
  static ignored_directories_in_source_blocks(self: AnnotateSnippetEmitter, value: string[]): AnnotateSnippetEmitter {
    self.ignored_directories_in_source_blocks = value;
    return self;
  }
  static diagnostic_width(self: AnnotateSnippetEmitter, value: number | undefined): AnnotateSnippetEmitter {
    self.diagnostic_width = value;
    return self;
  }
  static macro_backtrace(self: AnnotateSnippetEmitter, value: boolean): AnnotateSnippetEmitter {
    self.macro_backtrace = value;
    return self;
  }
  static track_diagnostics(self: AnnotateSnippetEmitter, value: boolean): AnnotateSnippetEmitter {
    self.track_diagnostics = value;
    return self;
  }
  static terminal_url(self: AnnotateSnippetEmitter, value: TerminalUrl): AnnotateSnippetEmitter {
    self.terminal_url = value;
    return self;
  }
  static theme(self: AnnotateSnippetEmitter, value: OutputTheme): AnnotateSnippetEmitter {
    self.theme = value;
    return self;
  }

  // ---- impl Emitter for AnnotateSnippetEmitter ----

  /// The entry point for the diagnostics generation
  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:82 emit_diagnostic
  emit_diagnostic(diag: DiagInner): void {
    if (this.track_diagnostics && diag.span.has_primary_spans() && !diag.span.is_dummy()) {
      diag.children.splice(0, 0, diag.emitted_at_sub_diag());
    }

    // PORT: `unwrap_tag` moves the vec out of `diag.suggestions`; copy it so clearing it in
    // `primary_span_formatted` cannot touch a shared array.
    const suggestions = [...Suggestions.unwrap_tag(diag.suggestions)];
    this.primary_span_formatted(diag.span, suggestions, diag.args);

    this.fix_multispans_in_extern_macros_and_render_macro_backtrace(diag.span, diag.children, diag.level, this.macro_backtrace);

    this.emit_messages_default(diag.level, diag.messages, diag.args, diag.code, diag.span, diag.children, suggestions);
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:108 source_map
  source_map(): SourceMap | undefined {
    return this.sm;
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:112 should_show_explain
  override should_show_explain(): boolean {
    return !this.short_message;
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:116 supports_color
  override supports_color(): boolean {
    return false;
  }

  // ---- impl AnnotateSnippetEmitter ----

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:144 new
  static new(dst: Destination): AnnotateSnippetEmitter {
    return new AnnotateSnippetEmitter(dst, undefined, false, false, [], undefined, false, false, "No", OutputTheme.Ascii);
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:159 emit_messages_default
  private emit_messages_default(
    level: Level,
    msgs: readonly [DiagMessage, Style][],
    args: DiagArgMap,
    code: ErrCode | undefined,
    msp: MultiSpan,
    children: readonly Subdiag[],
    suggestions: CodeSuggestion[],
  ): void {
    const renderer = this.renderer();
    const annotation_level = annotation_level_for_level(level);

    // If at least one portion of the message is styled, we need to
    // "pre-style" the message
    let title = msgs.some(([, style]) => style !== "NoStyle")
      ? annotation_level.secondary_title(this.pre_style_msgs(msgs, args))
      : annotation_level.primary_title(format_diag_messages(msgs, args));

    if (code !== undefined) {
      const c = code;
      title = annotate_snippets_Title.id(title, display_ErrCode(c));
      if (this.terminal_url === "Yes") {
        title = annotate_snippets_Title.id_url(title, `https://doc.rust-lang.org/error_codes/${display_ErrCode(c)}.html`);
      }
    }

    const report: Group[] = [];
    let group = Group.with_title(title);

    // If we don't have span information, emit and exit
    const sm = this.sm;
    if (sm === undefined) {
      group = Group.elements(
        group,
        children.map((c) => {
          const msg = format_diag_messages(c.messages, args);
          const level = annotation_level_for_sublevel(c.level);
          return Element.from_Message(level.message(msg));
        }),
      );

      report.push(group);
      const r = emit_to_destination(Renderer.render(renderer, report), level, this.dst, this.short_message);
      if (r.$ === "Err") {
        panic(`failed to emit error: ${display_IoError(r._0)}`);
      }
      return;
    }

    let file_ann = collect_annotations(args, msp, sm);

    // Make sure our primary file comes first
    const primary_span = msp.primary_span() ?? DUMMY_SP;
    if (!Span.is_dummy(primary_span)) {
      const primary_lo = sm.lookup_char_pos(Span.lo(primary_span));
      const pos = binary_search_by(file_ann, ([f]) => FileName_cmp(f.name, primary_lo.file.name));
      if (pos.ok) {
        swap(file_ann, 0, pos.i);
      }

      const file_ann_len = file_ann.length;
      for (let file_idx = 0; file_idx < file_ann.length; file_idx++) {
        const [file, annotations] = file_ann[file_idx]!;
        if (should_show_source_code(this.ignored_directories_in_source_blocks, sm, file)) {
          const snippet = this.annotated_snippet(annotations, file.name, sm);
          if (snippet !== undefined) {
            group = Group.element(group, Element.from_Snippet_Annotation(snippet));
          }
          // we can't annotate anything if the source is unavailable.
        } else if (!this.short_message) {
          // We'll just print unannotated messages
          group = this.unannotated_messages(annotations, file.name, sm, file_idx, report, group, annotation_level);
          // If this is the last annotation for a file, and
          // this is the last file, and the first child is a
          // "secondary" message, we need to add padding
          // ╭▸ /rustc/FAKE_PREFIX/library/core/src/clone.rs:236:13
          // │
          // ├ note: the late bound lifetime parameter
          // │ (<- It adds *this*)
          // ╰ warning: this was previously accepted
          const c = children[0];
          if (c !== undefined && !c.span.has_primary_spans() && !c.span.has_span_labels() && file_idx === file_ann_len - 1) {
            group = Group.element(group, Element.from_Padding(new Padding()));
          }
        }
      }
    }

    for (const c of children) {
      const level = annotation_level_for_sublevel(c.level);

      // If at least one portion of the message is styled, we need to
      // "pre-style" the message
      const msg = c.messages.some(([, style]) => style !== "NoStyle")
        ? this.pre_style_msgs(c.messages, args)
        : format_diag_messages(c.messages, args);

      // This is a secondary message with no span info
      if (!c.span.has_primary_spans() && !c.span.has_span_labels()) {
        group = Group.element(group, Element.from_Message(level.message(msg)));
        continue;
      }

      report.push(group);
      group = Group.with_title(level.secondary_title(msg));

      file_ann = collect_annotations(args, c.span, sm);
      const primary_span = c.span.primary_span() ?? DUMMY_SP;
      if (!Span.is_dummy(primary_span)) {
        const primary_lo = sm.lookup_char_pos(Span.lo(primary_span));
        const pos = binary_search_by(file_ann, ([f]) => FileName_cmp(f.name, primary_lo.file.name));
        if (pos.ok) {
          swap(file_ann, 0, pos.i);
        }
      }

      for (let file_idx = 0; file_idx < file_ann.length; file_idx++) {
        const [file, annotations] = file_ann[file_idx]!;
        if (should_show_source_code(this.ignored_directories_in_source_blocks, sm, file)) {
          const snippet = this.annotated_snippet(annotations, file.name, sm);
          if (snippet !== undefined) {
            group = Group.element(group, Element.from_Snippet_Annotation(snippet));
          }
          // we can't annotate anything if the source is unavailable.
        } else if (!this.short_message) {
          // We'll just print unannotated messages
          group = this.unannotated_messages(annotations, file.name, sm, file_idx, report, group, level);
        }
      }
    }

    for (const suggestion of suggestions) {
      switch (suggestion.style) {
        case "CompletelyHidden":
          // do not display this suggestion, it is meant only for tools
          break;
        case "HideCodeAlways": {
          const msg = format_diag_message(suggestion.msg, args);
          group = Group.element(group, Element.from_Message(annotate_snippets.Level.HELP.message(msg)));
          break;
        }
        case "HideCodeInline":
        case "ShowCode":
        case "ShowAlways": {
          const substitutions: Substitution[] = [];
          for (const subst0 of suggestion.substitutions) {
            // .filter(..)
            // Suggestions coming from macros can have malformed spans. This is a heavy
            // handed approach to avoid ICEs by ignoring the suggestion outright.
            const invalid = subst0.parts.some((item) => sm.is_valid_span(item.span).$ === "Err");
            if (invalid) {
              // debug!("suggestion contains an invalid span: {:?}", subst);
            }
            if (invalid) continue;

            // .filter_map(|mut subst| ..)
            const subst = ((): Substitution | undefined => {
              // PORT: `subst` is moved into the closure and mutated; a copy of the parts vec keeps
              // the diagnostic's own data untouched.
              const parts: SubstitutionPart[] = [...subst0.parts];
              // Assumption: all spans are in the same file, and all spans
              // are disjoint. Sort in ascending order.
              parts.sort((a, b) => Span.lo(a.span) - Span.lo(b.span));
              // Verify the assumption that all spans are disjoint
              // debug_assert_eq!(
              //     subst.parts.array_windows().find(|[a, b]| a.span.overlaps(b.span)),
              //     None,
              //     "all spans must be disjoint",
              // );

              if (parts.length === 0) return undefined;
              const lo = parts.map((part) => Span.lo(part.span)).reduce((a, b) => (b < a ? b : a));
              const lo_file = sm.lookup_source_file(lo);
              const hi = parts.map((part) => Span.hi(part.span)).reduce((a, b) => (b > a ? b : a));
              const hi_file = sm.lookup_source_file(hi);

              // The different spans might belong to different contexts, if so ignore suggestion.
              if (stable_source_file_id_key(lo_file.stable_id) !== stable_source_file_id_key(hi_file.stable_id)) {
                return undefined;
              }

              // We can't splice anything if the source is unavailable.
              if (!sm.ensure_source_file_source_present(lo_file)) {
                return undefined;
              }

              // Account for cases where we are suggesting the same code that's already
              // there. This shouldn't happen often, but in some cases for multipart
              // suggestions it's much easier to handle it here than in the origin.
              const retained = parts.filter((p) => is_different(sm, p.snippet, p.span));

              return retained.length === 0 ? undefined : { parts: retained };
            })();
            if (subst !== undefined) substitutions.push(subst);
          }

          if (substitutions.length === 0) {
            continue;
          }
          let msg = format_diag_message(suggestion.msg, args);

          let lo: BytePos | undefined;
          for (const sub of substitutions) {
            const p = sub.parts[0];
            if (p !== undefined) {
              lo = Span.lo(p.span);
              break;
            }
          }
          if (lo === undefined) panic("called `Option::unwrap()` on a `None` value");
          const file = sm.lookup_source_file(lo);

          const filename = sm.filename_for_diagnostics(file.name).to_string_lossy();

          const other_suggestions = Math.max(substitutions.length - MAX_SUGGESTIONS, 0);

          const subs: Snippet<Patch>[] = [];
          for (const sub of substitutions.slice(0, MAX_SUGGESTIONS)) {
            const snippet = ((): Snippet<Patch> | undefined => {
              let confusion_type: ConfusionType = ConfusionType.None;
              for (const part of sub.parts) {
                const part_confusion = detect_confusion_type(sm, part.snippet, part.span);
                confusion_type = ConfusionType.combine(confusion_type, part_confusion);
              }

              if (confusion_type !== "None") {
                msg += ConfusionType.label_text(confusion_type);
              }

              const parts: [Span, string][] = [];
              for (const p of sub.parts) {
                if (is_different(sm, p.snippet, p.span)) {
                  parts.push([p.span, p.snippet]);
                }
              }

              if (parts.length === 0) {
                return undefined;
              } else {
                const spans = parts.map(([span]) => span);
                // The suggestion adds an entire line of code, ending on a newline, so we'll also
                // print the *following* line, to provide context of what we're advising people to
                // do. Otherwise you would only see contextless code that can be confused for
                // already existing code, despite the colors and UI elements.
                // We special case `#[derive(_)]\n` and other attribute suggestions, because those
                // are the ones where context is most useful.
                let fold: boolean;
                let b: string | undefined;
                if (
                  parts.length === 1 &&
                  str_trim(parts[0]![1]).startsWith("#[") &&
                  // This allows for spaces to come between the attribute and the newline
                  str_trim(parts[0]![1]).endsWith("]") &&
                  parts[0]![1].endsWith("\n") &&
                  Span.hi(parts[0]![0]) === Span.lo(parts[0]![0]) &&
                  (b = prev_source_last_line(sm, parts[0]![0])) !== undefined &&
                  str_trim(b) === ""
                ) {
                  const part = parts[0]!;
                  // FIXME: This is a hack:
                  // The span for attribute suggestions often times points to the
                  // beginning of an item, disregarding leading whitespace. This
                  // causes the attribute to be properly indented, but leaves original
                  // item without indentation when rendered.
                  // This fixes that problem by adjusting the span to point to the start
                  // of the whitespace, and adds the whitespace to the replacement.
                  //
                  // Source: "    extern "custom" fn negate(a: i64) -> i64 {\n"
                  // Span: 4..4
                  // Replacement: "#[unsafe(naked)]\n"
                  //
                  // Before:
                  // help: convert this to an `#[unsafe(naked)]` function
                  //    |
                  // LL +     #[unsafe(naked)]
                  // LL | extern "custom" fn negate(a: i64) -> i64 {
                  //    |
                  //
                  // After
                  // help: convert this to an `#[unsafe(naked)]` function
                  //    |
                  // LL +     #[unsafe(naked)]
                  // LL |     extern "custom" fn negate(a: i64) -> i64 {
                  //    |
                  if (b !== "" && !part[1].endsWith(b)) {
                    part[1] = b + part[1];
                    const offset = BytePos(utf8_len(b));
                    part[0] = Span.shrink_to_lo(Span.with_lo(part[0], BytePos(Span.lo(part[0]) - offset)));
                  }
                  fold = false;
                } else {
                  fold = true;
                }

                const shrunk = shrink_file(spans, file.name, sm);
                if (shrunk !== undefined) {
                  const [bounding_span, source, line_offset] = shrunk;
                  const adj_lo = Span.lo(bounding_span);
                  return Snippet.patches(
                    Snippet.fold(Snippet.path(Snippet.line_start(Snippet.source<Patch>(source), line_offset), filename), fold),
                    parts.map(([span, replacement]) => {
                      const lo = saturating_sub(Span.lo(span), adj_lo);
                      const hi = saturating_sub(Span.hi(span), adj_lo);

                      return PatchC.new({ start: lo, end: hi }, Str.from(replacement));
                    }),
                  );
                } else {
                  return undefined;
                }
              }
            })();
            if (snippet !== undefined) subs.push(snippet);
          }
          if (subs.length !== 0) {
            report.push(group);
            group = Group.with_title(annotate_snippets.Level.HELP.secondary_title(msg));

            group = Group.elements(
              group,
              subs.map((s) => Element.from_Snippet_Patch(s)),
            );
            if (other_suggestions > 0) {
              group = Group.element(
                group,
                Element.from_Message(
                  annotate_snippets.Level.NOTE.no_name().message(
                    `and ${other_suggestions} other candidate${pluralize(other_suggestions)}`,
                  ),
                ),
              );
            }
          }
          break;
        }
      }
    }

    if (!Group.is_empty(group)) {
      report.push(group);
    }
    const r = emit_to_destination(Renderer.render(renderer, report), level, this.dst, this.short_message);
    if (r.$ === "Err") {
      panic(`failed to emit error: ${display_IoError(r._0)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:525 renderer
  private renderer(): Renderer {
    let width: number;
    if (this.diagnostic_width !== undefined) {
      width = this.diagnostic_width;
    } else if (this.ui_testing || /* cfg!(miri) */ false) {
      width = DEFAULT_TERM_WIDTH;
    } else {
      width = termize_dimensions()?.[0] ?? DEFAULT_TERM_WIDTH;
    }
    let decor_style: DecorStyle;
    switch (this.theme) {
      case "Ascii":
        decor_style = DecorStyle.Ascii;
        break;
      case "Unicode":
        decor_style = DecorStyle.Unicode;
        break;
    }

    let r: Renderer;
    switch (this.dst.current_choice()) {
      case ColorChoice.AlwaysAnsi:
      case ColorChoice.Always:
      case ColorChoice.Auto:
        r = Renderer.styled();
        break;
      case ColorChoice.Never:
        r = Renderer.plain();
        break;
    }
    r = Renderer.term_width(r, width);
    r = Renderer.anonymized_line_numbers(r, this.ui_testing);
    r = Renderer.decor_style(r, decor_style);
    r = Renderer.short_message(r, this.short_message);
    return r;
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:548 pre_style_msgs
  private pre_style_msgs(msgs: readonly [DiagMessage, Style][], args: DiagArgMap): string {
    let out = "";
    for (const [m, style] of msgs) {
      const text = format_diag_message(m, args);
      const style_ = Style_anstyle(style);
      if (text !== "") {
        out += `${Anstyle.fmt(style_, PLAIN)}${text}${Anstyle.fmt(style_, PRETTY)}`;
      }
    }
    return out;
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:558 annotated_snippet
  private annotated_snippet(annotations: Annotation[], file_name: FileName, sm: SourceMap): Snippet<AsAnnotation> | undefined {
    const spans = annotations.map((a) => a.span);
    const shrunk = shrink_file(spans, file_name, sm);
    if (shrunk !== undefined) {
      const [bounding_span, source, offset_line] = shrunk;
      const adj_lo = Span.lo(bounding_span);
      const filename = sm.filename_for_diagnostics(file_name).to_string_lossy();
      return Snippet.annotations(
        Snippet.path(Snippet.line_start(Snippet.source<AsAnnotation>(source), offset_line), filename),
        annotations.map((a) => {
          const lo = saturating_sub(Span.lo(a.span), adj_lo);
          const hi = saturating_sub(Span.hi(a.span), adj_lo);
          const ann = AnnotationKind.span(a.kind, { start: lo, end: hi });
          if (a.label !== undefined) {
            return annotate_snippets_Annotation.label(ann, a.label);
          } else {
            return ann;
          }
        }),
      );
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:581 unannotated_messages
  private unannotated_messages(
    annotations: Annotation[],
    file_name: FileName,
    sm: SourceMap,
    file_idx: number,
    report: Group[],
    group: Group,
    level: annotate_snippets.Level,
  ): Group {
    const filename = sm.filename_for_diagnostics(file_name).to_string_lossy();
    const line_tracker: number[] = [];
    for (let i = 0; i < annotations.length; i++) {
      const a = annotations[i]!;
      const lo = sm.lookup_char_pos(Span.lo(a.span));
      const hi = sm.lookup_char_pos(Span.hi(a.span));
      if (i === 0 || a.label !== undefined) {
        // Render each new file after the first in its own Group
        //    ╭▸ $DIR/deriving-meta-unknown-trait.rs:1:10
        //    │
        // LL │ #[derive(Eqr)]
        //    │          ━━━
        //    ╰╴ (<- It makes it so *this* will get printed)
        //    ╭▸ $SRC_DIR/core/src/option.rs:594:0
        //    ⸬  $SRC_DIR/core/src/option.rs:602:4
        //    │
        //    ╰ note: not covered
        if (i === 0 && file_idx !== 0) {
          report.push(group);
          group = Group.with_level(level);
        }

        if (!line_tracker.includes(lo.line) && (i === 0 || hi.line <= lo.line)) {
          line_tracker.push(lo.line);
          // ╭▸ $SRC_DIR/core/src/option.rs:594:0 (<- It adds *this*)
          // ⸬  $SRC_DIR/core/src/option.rs:602:4
          // │
          // ╰ note: not covered
          group = Group.element(
            group,
            Element.from_Origin(Origin.char_column(Origin.line(Origin.path(filename), sm.doctest_offset_line(file_name, lo.line)), lo.col_display)),
          );
        }

        if (hi.line > lo.line && a.label !== undefined && a.label !== "" && !line_tracker.includes(hi.line)) {
          line_tracker.push(hi.line);
          // ╭▸ $SRC_DIR/core/src/option.rs:594:0
          // ⸬  $SRC_DIR/core/src/option.rs:602:4 (<- It adds *this*)
          // │
          // ╰ note: not covered
          group = Group.element(
            group,
            Element.from_Origin(Origin.char_column(Origin.line(Origin.path(filename), sm.doctest_offset_line(file_name, hi.line)), hi.col_display)),
          );
        }

        const label = a.label;
        if (label !== undefined && label !== "") {
          // ╭▸ $SRC_DIR/core/src/option.rs:594:0
          // ⸬  $SRC_DIR/core/src/option.rs:602:4
          // │ (<- It adds *this*)
          // ╰ note: not covered (<- and *this*)
          group = Group.element(Group.element(group, Element.from_Padding(new Padding())), Element.from_Message(annotate_snippets.Level.NOTE.message(label)));
        }
      }
    }
    return group;
  }
}

/** `impl Debug for AnnotateSnippetEmitter` */
// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:51 fmt
export const debug_AnnotateSnippetEmitter: Debug<AnnotateSnippetEmitter> = (self, f) => {
  // `.field("dst", &format_args!("<writer@{dst:p}>"))` prints the writer's address.
  const dst = unported("rustc_errors::annotate_snippet_emitter_writer: `{:p}` of the destination writer (a memory address)");
  return debug_struct(f, "AnnotateSnippetEmitter", [
    ["dst", dst],
    ["sm", debug_option(self.sm, f, debug_SourceMap)],
    ["short_message", debug_bool(self.short_message, f)],
    ["ui_testing", debug_bool(self.ui_testing, f)],
    ["ignored_directories_in_source_blocks", debug_vec(self.ignored_directories_in_source_blocks, f, (x) => debug_str(x))],
    ["diagnostic_width", debug_option(self.diagnostic_width, f, debug_int)],
    ["macro_backtrace", debug_bool(self.macro_backtrace, f)],
    ["track_diagnostics", debug_bool(self.track_diagnostics, f)],
    ["terminal_url", debug_TerminalUrl(self.terminal_url, f)],
    ["theme", debug_OutputTheme(self.theme, f)],
  ]);
};

// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:121 annotation_level_for_level
function annotation_level_for_level(level: Level): annotate_snippets.Level {
  switch (level.$) {
    case "Bug":
    case "DelayedBug":
      return annotate_snippets.Level.ERROR.with_name("error: internal compiler error");
    case "Fatal":
    case "Error":
      return annotate_snippets.ERROR;
    case "Warning":
      return annotate_snippets.Level.WARNING;
    case "Note":
      return annotate_snippets.Level.NOTE;
    case "Help":
      return annotate_snippets.Level.HELP;
    case "FailureNote":
      return annotate_snippets.Level.NOTE.no_name();
  }
}

// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:134 annotation_level_for_sublevel
function annotation_level_for_sublevel(level: Sublevel): annotate_snippets.Level {
  switch (level) {
    case "Error":
      return annotate_snippets.Level.ERROR;
    case "Warning":
      return annotate_snippets.Level.WARNING;
    case "Note":
    case "OnceNote":
      return annotate_snippets.Level.NOTE;
    case "Help":
    case "OnceHelp":
      return annotate_snippets.Level.HELP;
  }
}

// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:657 emit_to_destination
function emit_to_destination(rendered: string, lvl: Level, dst: Destination, short_message: boolean): IoResult<void> {
  const _buffer_lock = lock.acquire_global_lock("rustc_errors");
  // writeln!(dst, "{rendered}")?;
  let r = dst.write_fmt([rendered, "\n"]);
  if (r.$ === "Err") return r;
  if (!short_message && !Level.is_failure_note(lvl)) {
    // writeln!(dst)?;
    r = dst.write_fmt(["\n"]);
    if (r.$ === "Err") return r;
  }
  r = dst.flush();
  if (r.$ === "Err") return r;
  return Ok(undefined);
}

interface Annotation {
  kind: AnnotationKind;
  span: Span;
  label: string | undefined;
}
/** `#[derive(Debug)]` */
export const debug_Annotation: Debug<Annotation> = (v, f) =>
  debug_struct(f, "Annotation", [
    ["kind", v.kind],
    ["span", debug_Span(v.span, f)],
    ["label", debug_option(v.label, f, (x) => debug_str(x))],
  ]);

// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:680 collect_annotations
function collect_annotations(args: DiagArgMap, msp: MultiSpan, sm: SourceMap): [SourceFile, Annotation[]][] {
  const output: [SourceFile, Annotation[]][] = [];

  for (const { span: span0, is_primary, label } of msp.span_labels_() as SpanLabel[]) {
    // If we don't have a useful span, pick the primary span if that exists.
    // Worst case we'll just print an error at the top of the main file.
    const primary = msp.primary_span();
    const span = primary === undefined || !Span.is_dummy(span0) ? span0 : primary;
    const file = sm.lookup_source_file(Span.lo(span));

    const kind: AnnotationKind = is_primary ? "Primary" : "Context";

    const label_ = label !== undefined ? normalize_whitespace(format_diag_message(label, args)) : undefined;

    const ann: Annotation = { kind, span, label: label_ };
    if (sm.is_valid_span(ann.span).$ === "Ok") {
      // Look through each of our files for the one we're adding to. We
      // use each files `stable_id` to avoid issues with file name
      // collisions when multiple versions of the same crate are present
      // in the dependency graph
      const key = stable_source_file_id_key(file.stable_id);
      const found = output.find(([f]) => stable_source_file_id_key(f.stable_id) === key);
      if (found !== undefined) {
        found[1].push(ann);
      } else {
        output.push([file, [ann]]);
      }
    }
  }

  for (const span of msp.span_context_()) {
    const file = sm.lookup_source_file(Span.lo(span));
    const ann: Annotation = { kind: "Visible", span, label: undefined };
    const key = stable_source_file_id_key(file.stable_id);
    const found = output.find(([f]) => stable_source_file_id_key(f.stable_id) === key);
    if (found !== undefined) {
      found[1].push(ann);
    } else {
      output.push([file, [ann]]);
    }
  }

  // Sort annotations within each file by line number
  for (const [, ann] of output) {
    // `sort_by_key` is stable, like `Array.prototype.sort`; the key is computed per comparison upstream too.
    ann.sort((a, b) => sm.lookup_char_pos(Span.lo(a.span)).line - sm.lookup_char_pos(Span.lo(b.span)).line);
  }
  return output;
}

// rustc: compiler/rustc_errors/src/annotate_snippet_emitter_writer.rs:738 shrink_file
function shrink_file(spans: readonly Span[], file_name: FileName, sm: SourceMap): [Span, Str, number] | undefined {
  if (spans.length === 0) return undefined;
  const lo_byte = spans.map((s) => Span.lo(s)).reduce((a, b) => (b < a ? b : a));
  const lo_loc = sm.lookup_char_pos(lo_byte);

  const hi_byte = spans.map((s) => Span.hi(s)).reduce((a, b) => (b > a ? b : a));
  const hi_loc = sm.lookup_char_pos(hi_byte);

  if (stable_source_file_id_key(lo_loc.file.stable_id) !== stable_source_file_id_key(hi_loc.file.stable_id)) {
    // this may happen when spans cross file boundaries due to macro expansion.
    return undefined;
  }

  const lo = lo_loc.file.line_bounds(saturating_sub(lo_loc.line, 1))[0];
  const hi = hi_loc.file.line_bounds(saturating_sub(hi_loc.line, 1))[1];

  const bounding_span = Span.with_root_ctxt(lo, hi);
  const r = sm.span_to_snippet(bounding_span);
  if (r.$ === "Err") return undefined;
  const source = r._0;
  const offset_line = sm.doctest_offset_line(file_name, lo_loc.line);

  return [bounding_span, source, offset_line];
}

// ---- helpers (std / other-crate pieces used above) ------------------------------------------------

/** `usize::saturating_sub` */
function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

/** `<[T]>::swap` */
function swap<T>(v: T[], a: number, b: number): void {
  const t = v[a]!;
  v[a] = v[b]!;
  v[b] = t;
}

/**
 * `sm.span_to_prev_source(*p)` then `b.rsplit_once('\n').unwrap_or_else(|| ("", &b)).1`;
 * `undefined` when `span_to_prev_source` errs (the `let Ok(b) = ..` guard fails).
 */
function prev_source_last_line(sm: SourceMap, p: Span): string | undefined {
  const r = sm.span_to_prev_source(p);
  if (r.$ === "Err") return undefined;
  const b = r._0.toString();
  const i = b.lastIndexOf("\n");
  return i === -1 ? b : b.slice(i + 1);
}

// PORT: `#[derive(Ord)]` on `FileName`/`RealFileName`/`InnerRealFileName` (rustc_span) and
// `Ord for Path` (std: `compare_components`, i.e. `Iterator::cmp` over `Components`; the fast path
// is an optimisation with the same result). Belongs next to `FileName_eq` in rustc_span.
const FILE_NAME_VARIANTS = ["Real", "CfgSpec", "Anon", "MacroExpansion", "ProcMacroSourceCode", "CliCrateAttr", "Custom", "DocTest", "InlineAsm"];
type Ordering = -1 | 0 | 1;

function FileName_cmp(a: FileName, b: FileName): Ordering {
  const da = FILE_NAME_VARIANTS.indexOf(a.$);
  const db = FILE_NAME_VARIANTS.indexOf(b.$);
  if (da !== db) return da < db ? -1 : 1;
  switch (a.$) {
    case "Real":
      return RealFileName_cmp(a._0, (b as typeof a)._0);
    case "Custom":
      return str_cmp(a._0, (b as typeof a)._0);
    case "DocTest": {
      const bb = b as typeof a;
      const c = RealFileName_cmp(a._0, bb._0);
      if (c !== 0) return c;
      return a._1 < bb._1 ? -1 : a._1 > bb._1 ? 1 : 0;
    }
    default: {
      const x = a._0;
      const y = (b as typeof a)._0;
      return x < y ? -1 : x > y ? 1 : 0;
    }
  }
}

type InnerRealFileName = NonNullable<RealFileName["local"]>;

function RealFileName_cmp(a: RealFileName, b: RealFileName): Ordering {
  // local: Option<InnerRealFileName> (None < Some)
  if (a.local === undefined || b.local === undefined) {
    if (a.local !== undefined) return 1;
    if (b.local !== undefined) return -1;
  } else {
    const c = InnerRealFileName_cmp(a.local, b.local);
    if (c !== 0) return c;
  }
  const c = InnerRealFileName_cmp(a.maybe_remapped, b.maybe_remapped);
  if (c !== 0) return c;
  return a.scopes < b.scopes ? -1 : a.scopes > b.scopes ? 1 : 0;
}

function InnerRealFileName_cmp(a: InnerRealFileName, b: InnerRealFileName): Ordering {
  let c = path_cmp(a.name, b.name);
  if (c !== 0) return c;
  c = path_cmp(a.working_directory, b.working_directory);
  if (c !== 0) return c;
  return path_cmp(a.embeddable_name, b.embeddable_name);
}

const COMPONENT_VARIANTS = ["Prefix", "RootDir", "CurDir", "ParentDir", "Normal"];

function path_cmp(a: string, b: string): Ordering {
  const left = path_components(a);
  const right = path_components(b);
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x === undefined) return y === undefined ? 0 : -1;
    if (y === undefined) return 1;
    const c = component_cmp(x, y);
    if (c !== 0) return c;
  }
}

function component_cmp(a: Component, b: Component): Ordering {
  const da = COMPONENT_VARIANTS.indexOf(a.$);
  const db = COMPONENT_VARIANTS.indexOf(b.$);
  if (da !== db) return da < db ? -1 : 1;
  if (a.$ === "Normal") return str_cmp(a._0, (b as typeof a)._0);
  if (a.$ === "Prefix") return unported("std::path::PrefixComponent Ord (Windows path prefixes)");
  return 0;
}

/** `str`/`OsStr` `Ord`: byte-wise on UTF-8 = code-point order. */
function str_cmp(a: string, b: string): Ordering {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i]!.codePointAt(0)!;
    const q = y[i]!.codePointAt(0)!;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length < y.length ? -1 : x.length > y.length ? 1 : 0;
}

