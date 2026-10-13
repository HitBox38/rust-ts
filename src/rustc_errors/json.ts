//! A JSON emitter for errors.
//!
//! This works by converting errors to a simplified structural format (see the
//! structs at the start of the file) and then serializing them. These should
//! contain as much information about the error as possible.
//!
//! The format of the JSON output should be considered *unstable*. For now the
//! structs at the end of this file (Diagnostic*) specify the error format.
// Port of compiler/rustc_errors/src/json.rs.
//
// PORT: representation decisions for this file:
// - `pub mod json;` is not re-exported from lib.ts: `JsonEmitter` extends `emitter::Emitter`, so it has
//   the same ESM-cycle constraint as `annotate_snippet_emitter_writer` (import this module directly).
// - `#[derive(Setters)]` -> static builder functions on the class (as in annotate_snippet_emitter_writer.ts).
// - `IntoDynSyncSend<Box<dyn Write + Send>>` -> the `Write` itself; `Arc<SourceMap>` -> the object.
// - `#[derive(Serialize)]` + `serde_json` -> `ser_<Type>` functions building a `JsonValue` (fields in
//   declaration order, `Option::None` as `null`, internally tagged `EmitTyped`), printed by the small
//   serde_json-compatible writer at the end of this file (compact `to_writer` / 2-space `to_writer_pretty`).

// FIXME: spec the JSON output properly.

import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { type FmtArguments, type Write, VecU8, Write_default, dyn_write } from "../vendor/anstream/stream.ts";
import type { DiagArgMap, MultiSpan, SpanLabel } from "../rustc_error_messages/lib.ts";
import { type Applicability, Level as LintLevel } from "../rustc_lint_defs/lib.ts";
import { type ExpnData, ExpnKind } from "../rustc_span/hygiene.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { BytePos, DUMMY_SP, type FileName, RealFileName, type SourceFile, Span } from "../rustc_span/lib.ts";
import { PLAIN, debug_list, debug_struct } from "../std/fmt.ts";
import { type IoResult, debug_IoError } from "../std/io.ts";
import { panic } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import { Str, type Utf8Error, from_utf8, utf8 } from "../std/str.ts";
import { AnnotateSnippetEmitter } from "./annotate_snippet_emitter_writer.ts";
import { ColorConfig, type Destination, Emitter, HumanReadableErrorType, OutputTheme, type TimingEvent, should_show_source_code } from "./emitter.ts";
import { format_diag_message, format_diag_messages } from "./formatting.ts";
import type { TimingRecord } from "./timings.ts";
import * as codes from "./codes.ts";
import type { CodeSuggestion, DiagInner, Subdiag, TerminalUrl } from "./lib.ts";
import { Level, Sublevel } from "./lib.ts";

// #[cfg(test)]
// mod tests;  (json/tests.test.ts)

export class JsonEmitter extends Emitter {
  constructor(
    // #[setters(skip)]
    public dst: Write,
    // #[setters(skip)]
    public sm: SourceMap | undefined,
    // #[setters(skip)]
    public pretty: boolean,
    public ui_testing: boolean,
    public ignored_directories_in_source_blocks: string[],
    // #[setters(skip)]
    public json_rendered: HumanReadableErrorType,
    public color_config: ColorConfig,
    public diagnostic_width: number | undefined,
    public macro_backtrace: boolean,
    public track_diagnostics: boolean,
    public terminal_url: TerminalUrl,
  ) {
    super();
  }

  // ---- #[derive(Setters)] ----

  static ui_testing(self: JsonEmitter, value: boolean): JsonEmitter {
    self.ui_testing = value;
    return self;
  }
  static ignored_directories_in_source_blocks(self: JsonEmitter, value: string[]): JsonEmitter {
    self.ignored_directories_in_source_blocks = value;
    return self;
  }
  static color_config(self: JsonEmitter, value: ColorConfig): JsonEmitter {
    self.color_config = value;
    return self;
  }
  static diagnostic_width(self: JsonEmitter, value: number | undefined): JsonEmitter {
    self.diagnostic_width = value;
    return self;
  }
  static macro_backtrace(self: JsonEmitter, value: boolean): JsonEmitter {
    self.macro_backtrace = value;
    return self;
  }
  static track_diagnostics(self: JsonEmitter, value: boolean): JsonEmitter {
    self.track_diagnostics = value;
    return self;
  }
  static terminal_url(self: JsonEmitter, value: TerminalUrl): JsonEmitter {
    self.terminal_url = value;
    return self;
  }

  // ---- impl JsonEmitter ----

  // rustc: compiler/rustc_errors/src/json.rs:60 new
  static new(
    dst: Write,
    sm: SourceMap | undefined,
    pretty: boolean,
    json_rendered: HumanReadableErrorType,
    color_config: ColorConfig,
  ): JsonEmitter {
    return new JsonEmitter(
      dst,
      sm,
      pretty,
      /* ui_testing */ false,
      /* ignored_directories_in_source_blocks */ [],
      json_rendered,
      color_config,
      /* diagnostic_width */ undefined,
      /* macro_backtrace */ false,
      /* track_diagnostics */ false,
      /* terminal_url */ "No",
    );
  }

  // rustc: compiler/rustc_errors/src/json.rs:82 emit
  private emit(val: EmitTyped): IoResult<void> {
    // PORT: serde_json writes the value in many small pieces; here it is built as one string and
    // written with a single `write_all` (same bytes; `dst` is flushed right after anyway).
    let r: IoResult<void>;
    if (this.pretty) {
      r = this.dst.write_all(utf8(serde_json_to_string_pretty(ser_EmitTyped(val))));
    } else {
      r = this.dst.write_all(utf8(serde_json_to_string(ser_EmitTyped(val))));
    }
    if (r.$ === "Err") return r;
    r = this.dst.write_all(utf8("\n"));
    if (r.$ === "Err") return r;
    return this.dst.flush();
  }

  // ---- impl Emitter for JsonEmitter ----

  // rustc: compiler/rustc_errors/src/json.rs:104 emit_diagnostic
  emit_diagnostic(diag: DiagInner): void {
    const data = Diagnostic.from_errors_diagnostic(diag, this);
    const result = this.emit({ $: "Diagnostic", _0: data });
    if (result.$ === "Err") {
      panic(`failed to print diagnostics: ${debug_IoError(result._0, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/json.rs:112 emit_artifact_notification
  override emit_artifact_notification(path: string, artifact_type: string): void {
    const data: ArtifactNotification = { artifact: path, emit: artifact_type };
    const result = this.emit({ $: "Artifact", _0: data });
    if (result.$ === "Err") {
      panic(`failed to print notification: ${debug_IoError(result._0, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/json.rs:120 emit_timing_section
  override emit_timing_section(record: TimingRecord, event_: TimingEvent): void {
    let event: string;
    switch (event_) {
      case "Start":
        event = "start";
        break;
      case "End":
        event = "end";
        break;
    }
    let name: string;
    switch (record.section) {
      case "Linking":
        name = "link";
        break;
      case "Codegen":
        name = "codegen";
        break;
    }
    const data: SectionTimestamp = { name, event, timestamp: record.timestamp };
    const result = this.emit({ $: "SectionTiming", _0: data });
    if (result.$ === "Err") {
      panic(`failed to print timing section: ${debug_IoError(result._0, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/json.rs:136 emit_future_breakage_report
  override emit_future_breakage_report(diags: DiagInner[]): void {
    const data: FutureBreakageItem[] = diags.map((diag) => ({
      diagnostic: { $: "Diagnostic", _0: Diagnostic.from_errors_diagnostic(diag, this) },
    }));
    const report: FutureIncompatReport = { future_incompat_report: data };
    const result = this.emit({ $: "FutureIncompat", _0: report });
    if (result.$ === "Err") {
      panic(`failed to print future breakage report: ${debug_IoError(result._0, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/json.rs:150 emit_unused_externs
  override emit_unused_externs(lint_level_: LintLevel, unused_externs: readonly string[]): void {
    const lint_level = LintLevel.as_str(lint_level_);
    const data: UnusedExterns = { lint_level, unused_extern_names: unused_externs };
    const result = this.emit({ $: "UnusedExtern", _0: data });
    if (result.$ === "Err") {
      panic(`failed to print unused externs: ${debug_IoError(result._0, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_errors/src/json.rs:159 source_map
  source_map(): SourceMap | undefined {
    return this.sm;
  }

  // rustc: compiler/rustc_errors/src/json.rs:163 should_show_explain
  override should_show_explain(): boolean {
    return !this.json_rendered.short_();
  }
}

// #[derive(Serialize)]
// #[serde(tag = "$message_type", rename_all = "snake_case")]
type EmitTyped =
  | { readonly $: "Diagnostic"; readonly _0: Diagnostic }
  | { readonly $: "Artifact"; readonly _0: ArtifactNotification }
  | { readonly $: "SectionTiming"; readonly _0: SectionTimestamp }
  | { readonly $: "FutureIncompat"; readonly _0: FutureIncompatReport }
  | { readonly $: "UnusedExtern"; readonly _0: UnusedExterns };

// The following data types are provided just for serialisation.

// #[derive(Serialize)]
class Diagnostic {
  constructor(
    /// The primary error message.
    public message: string,
    public code: DiagnosticCode | undefined,
    /// "error: internal compiler error", "error", "warning", "note", "help".
    public level: string,
    public spans: DiagnosticSpan[],
    /// Associated diagnostic messages.
    public children: Diagnostic[],
    /// The message as rustc would render it.
    public rendered: string | undefined,
  ) {}

  // ---- impl Diagnostic ----

  /// Converts from `rustc_errors::DiagInner` to `Diagnostic`.
  // rustc: compiler/rustc_errors/src/json.rs:288 from_errors_diagnostic
  static from_errors_diagnostic(diag: DiagInner, je: JsonEmitter): Diagnostic {
    const sugg_to_diag = (sugg: CodeSuggestion): Diagnostic => {
      const formatted_message = format_diag_message(sugg.msg, diag.args);
      return new Diagnostic(
        /* message */ formatted_message,
        /* code */ undefined,
        /* level */ "help",
        /* spans */ DiagnosticSpan.from_suggestion(sugg, diag.args, je),
        /* children */ [],
        /* rendered */ undefined,
      );
    };
    // PORT: the lazy `iter().map(sugg_to_diag)` is run where upstream `collect`s it (after the
    // children); it is a snapshot of the suggestions taken here, before the emitter below edits `diag`.
    let sugg: readonly CodeSuggestion[];
    switch (diag.suggestions.$) {
      case "Enabled":
        sugg = [...diag.suggestions._0];
        break;
      case "Sealed":
        sugg = [...diag.suggestions._0];
        break;
      case "Disabled":
        sugg = [];
        break;
    }

    // generate regular command line output and store it in the json

    const formatted_message = format_diag_messages(diag.messages, diag.args);

    let code: DiagnosticCode | undefined;
    if (diag.code !== undefined) {
      const r = codes.try_find_description(diag.code);
      code = {
        code: codes.display_ErrCode(diag.code),
        // PORT: `.ok()` of the `&'static str`; reading the text of an existing description is
        // `unported` in codes.ts (the Markdown is not embedded).
        explanation: r.$ === "Ok" ? r._0.text() : undefined,
      };
    } else if (diag.is_lint !== undefined) {
      const { name } = diag.is_lint;
      code = { code: name, explanation: undefined };
    } else {
      code = undefined;
    }
    const level = Level.to_str(diag.level);
    const spans = DiagnosticSpan.from_multispan(diag.span, diag.args, je);
    const children: Diagnostic[] = [
      ...diag.children.map((c) => Diagnostic.from_sub_diagnostic(c, diag.args, je)),
      ...sugg.map(sugg_to_diag),
    ];
    if (je.track_diagnostics && diag.span.has_primary_spans() && !diag.span.is_dummy()) {
      children.splice(0, 0, Diagnostic.from_sub_diagnostic(diag.emitted_at_sub_diag(), diag.args, je));
    }
    const buf = new BufWriter(new VecU8());
    let choice = ColorConfig.to_color_choice(je.color_config);
    if (choice === ColorChoice.Auto) {
      choice = ColorChoice.Always;
    }
    const dst: Destination = AutoStream.new(dyn_write(buf.clone()), choice);
    let emitter = AnnotateSnippetEmitter.new(dst);
    emitter = AnnotateSnippetEmitter.short_message(emitter, je.json_rendered.short);
    emitter = AnnotateSnippetEmitter.sm(emitter, je.sm);
    emitter = AnnotateSnippetEmitter.diagnostic_width(emitter, je.diagnostic_width);
    emitter = AnnotateSnippetEmitter.macro_backtrace(emitter, je.macro_backtrace);
    emitter = AnnotateSnippetEmitter.track_diagnostics(emitter, je.track_diagnostics);
    emitter = AnnotateSnippetEmitter.terminal_url(emitter, je.terminal_url);
    emitter = AnnotateSnippetEmitter.ui_testing(emitter, je.ui_testing);
    emitter = AnnotateSnippetEmitter.ignored_directories_in_source_blocks(emitter, [...je.ignored_directories_in_source_blocks]);
    emitter = AnnotateSnippetEmitter.theme(emitter, je.json_rendered.unicode ? OutputTheme.Unicode : OutputTheme.Ascii);
    emitter.emit_diagnostic(diag);

    // PORT: `Arc::try_unwrap(..).unwrap().into_inner().unwrap()` cannot fail (the emitter holding the
    // other clone is gone); `String::from_utf8(buf).unwrap()`: the rendered text is always UTF-8.
    const bytes = buf._0.bytes();
    const rendered = unwrap_result(from_utf8(bytes), (e: Utf8Error, f) =>
      // `#[derive(Debug)] struct FromUtf8Error { bytes: Vec<u8>, error: Utf8Error }`
      debug_struct(f, "FromUtf8Error", [
        ["bytes", debug_list(f, [...bytes].map(String))],
        ["error", e.debug()],
      ]),
    );

    return new Diagnostic(formatted_message, code, level, spans, children, rendered);
  }

  // rustc: compiler/rustc_errors/src/json.rs:373 from_sub_diagnostic
  static from_sub_diagnostic(subdiag: Subdiag, args: DiagArgMap, je: JsonEmitter): Diagnostic {
    const formatted_message = format_diag_messages(subdiag.messages, args);
    return new Diagnostic(
      /* message */ formatted_message,
      /* code */ undefined,
      /* level */ Sublevel.to_str(subdiag.level),
      /* spans */ DiagnosticSpan.from_multispan(subdiag.span, args, je),
      /* children */ [],
      /* rendered */ undefined,
    );
  }
}

// A threadsafe buffer for writing.
// #[derive(Clone)]
// PORT: `struct BufWriter(Arc<Mutex<Vec<u8>>>)` (local to `from_errors_diagnostic` upstream); a clone
// shares the same `VecU8`.
class BufWriter implements Write {
  constructor(public _0: VecU8) {}

  clone(): BufWriter {
    return new BufWriter(this._0);
  }

  // rustc: compiler/rustc_errors/src/json.rs:313 write
  write(buf: Uint8Array): IoResult<number> {
    return this._0.write(buf);
  }

  // rustc: compiler/rustc_errors/src/json.rs:316 flush
  flush(): IoResult<void> {
    return this._0.flush();
  }

  /** `std::io::Write` provided method. */
  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }

  /** `std::io::Write` provided method. */
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }
}

// #[derive(Serialize)]
class DiagnosticSpan {
  constructor(
    public file_name: string,
    public byte_start: number,
    public byte_end: number,
    /// 1-based.
    public line_start: number,
    public line_end: number,
    /// 1-based, character offset.
    public column_start: number,
    public column_end: number,
    /// Is this a "primary" span -- meaning the point, or one of the points,
    /// where the error occurred?
    public is_primary: boolean,
    /// Source text from the start of line_start to the end of line_end.
    public text: DiagnosticSpanLine[],
    /// Label that should be placed at this location (if any)
    public label: string | undefined,
    /// If we are suggesting a replacement, this will contain text
    /// that should be sliced in atop this span.
    public suggested_replacement: string | undefined,
    /// If the suggestion is approximate
    public suggestion_applicability: Applicability | undefined,
    /// Macro invocations that created the code at this span, if any.
    public expansion: DiagnosticSpanMacroExpansion | undefined,
  ) {}

  // ---- impl DiagnosticSpan ----

  // rustc: compiler/rustc_errors/src/json.rs:387 from_span_label
  static from_span_label(
    span: SpanLabel,
    suggestion: [string, Applicability] | undefined,
    args: DiagArgMap,
    je: JsonEmitter,
  ): DiagnosticSpan {
    return DiagnosticSpan.from_span_etc(
      span.span,
      span.is_primary,
      span.label !== undefined ? format_diag_message(span.label, args) : undefined,
      suggestion,
      je,
    );
  }

  // rustc: compiler/rustc_errors/src/json.rs:402 from_span_etc
  static from_span_etc(
    span: Span,
    is_primary: boolean,
    label: string | undefined,
    suggestion: [string, Applicability] | undefined,
    je: JsonEmitter,
  ): DiagnosticSpan {
    // obtain the full backtrace from the `macro_backtrace`
    // helper; in some ways, it'd be better to expand the
    // backtrace ourselves, but the `macro_backtrace` helper makes
    // some decision, such as dropping some frames, and I don't
    // want to duplicate that logic here.
    const backtrace = Span.macro_backtrace(span);
    return DiagnosticSpan.from_span_full(span, is_primary, label, suggestion, backtrace, je);
  }

  // rustc: compiler/rustc_errors/src/json.rs:418 from_span_full
  static from_span_full(
    span: Span,
    is_primary: boolean,
    label: string | undefined,
    suggestion: [string, Applicability] | undefined,
    backtrace: Iterator<ExpnData>,
    je: JsonEmitter,
  ): DiagnosticSpan {
    let sm: SourceMap;
    if (je.sm !== undefined) {
      sm = je.sm;
    } else {
      span = DUMMY_SP;
      const empty_source_map = SourceMap.new(FilePathMapping.empty());
      const name: FileName = {
        $: "Real",
        _0: empty_source_map.path_mapping().to_real_filename(RealFileName.empty(), "empty.rs"),
      };
      empty_source_map.new_source_file(name, Str.from(""));
      sm = empty_source_map;
    }
    const start = sm.lookup_char_pos(Span.lo(span));
    // If this goes from the start of a line to the end and the replacement
    // is an empty string, increase the length to include the newline so we don't
    // leave an empty line
    if (start.col === 0 && suggestion !== undefined && suggestion[0] === "") {
      const after = sm.span_to_next_source(span);
      if (after.$ === "Ok" && after._0.starts_with("\n")) {
        span = Span.with_hi(span, BytePos.add(Span.hi(span), BytePos(1)));
      }
    }
    const end = sm.lookup_char_pos(Span.hi(span));
    let backtrace_step: DiagnosticSpanMacroExpansion | undefined;
    const bt_next = backtrace.next();
    if (!bt_next.done) {
      const bt = bt_next.value;
      const call_site = DiagnosticSpan.from_span_full(bt.call_site, false, undefined, undefined, backtrace, je);
      const def_site_span = DiagnosticSpan.from_span_full(
        sm.guess_head_span(bt.def_site),
        false,
        undefined,
        undefined,
        [][Symbol.iterator](),
        je,
      );
      backtrace_step = {
        span: call_site,
        macro_decl_name: ExpnKind.descr(bt.kind),
        def_site_span,
      };
    } else {
      backtrace_step = undefined;
    }

    return new DiagnosticSpan(
      /* file_name */ sm.filename_for_diagnostics(start.file.name).to_string(),
      /* byte_start */ start.file.original_relative_byte_pos(Span.lo(span)),
      /* byte_end */ start.file.original_relative_byte_pos(Span.hi(span)),
      /* line_start */ start.line,
      /* line_end */ end.line,
      /* column_start */ start.col + 1,
      /* column_end */ end.col + 1,
      /* is_primary */ is_primary,
      /* text */ DiagnosticSpanLine.from_span(span, je),
      /* label */ label,
      /* suggested_replacement */ suggestion !== undefined ? suggestion[0] : undefined,
      /* suggestion_applicability */ suggestion !== undefined ? suggestion[1] : undefined,
      /* expansion */ backtrace_step,
    );
  }

  // rustc: compiler/rustc_errors/src/json.rs:490 from_multispan
  static from_multispan(msp: MultiSpan, args: DiagArgMap, je: JsonEmitter): DiagnosticSpan[] {
    return msp.span_labels_().map((span_str) => DiagnosticSpan.from_span_label(span_str, undefined, args, je));
  }

  // rustc: compiler/rustc_errors/src/json.rs:497 from_suggestion
  static from_suggestion(suggestion: CodeSuggestion, args: DiagArgMap, je: JsonEmitter): DiagnosticSpan[] {
    return suggestion.substitutions.flatMap((substitution) =>
      substitution.parts.map((suggestion_inner) => {
        const span_label: SpanLabel = { span: suggestion_inner.span, is_primary: true, label: undefined };
        return DiagnosticSpan.from_span_label(span_label, [suggestion_inner.snippet, suggestion.applicability], args, je);
      }),
    );
  }
}

// #[derive(Serialize)]
class DiagnosticSpanLine {
  constructor(
    public text: string,

    /// 1-based, character offset in self.text.
    public highlight_start: number,

    public highlight_end: number,
  ) {}

  // ---- impl DiagnosticSpanLine ----

  // rustc: compiler/rustc_errors/src/json.rs:522 line_from_source_file
  static line_from_source_file(sf: SourceFile, index: number, h_start: number, h_end: number): DiagnosticSpanLine {
    const l = sf.get_line(index);
    return new DiagnosticSpanLine(
      /* text */ l !== undefined ? l.toString() : "",
      /* highlight_start */ h_start,
      /* highlight_end */ h_end,
    );
  }

  /// Creates a list of DiagnosticSpanLines from span - each line with any part
  /// of `span` gets a DiagnosticSpanLine, with the highlight indicating the
  /// `span` within the line.
  // rustc: compiler/rustc_errors/src/json.rs:538 from_span
  static from_span(span: Span, je: JsonEmitter): DiagnosticSpanLine[] {
    const sm = je.sm;
    if (sm === undefined) return [];
    const r = sm.span_to_lines(span);
    if (r.$ !== "Ok") return [];
    const lines = r._0;
    // We can't get any lines if the source is unavailable.
    if (!should_show_source_code(je.ignored_directories_in_source_blocks, sm, lines.file)) {
      return [];
    }

    const sf = lines.file;
    const span_lines = lines.lines.map((line) =>
      DiagnosticSpanLine.line_from_source_file(sf, line.line_index, line.start_col + 1, line.end_col + 1),
    );
    return span_lines;
  }
}

// #[derive(Serialize)]
interface DiagnosticSpanMacroExpansion {
  /// span where macro was applied to generate this code; note that
  /// this may itself derive from a macro (if
  /// `span.expansion.is_some()`)
  span: DiagnosticSpan;

  /// name of macro that was applied (e.g., "foo!" or "#[derive(Eq)]")
  macro_decl_name: string;

  /// span where macro was defined (if known)
  def_site_span: DiagnosticSpan;
}

// #[derive(Serialize)]
interface DiagnosticCode {
  /// The error code (e.g. "E1234"), if the diagnostic has one. Or the lint
  /// name, if it's a lint without an error code.
  code: string;
  /// An explanation for the code.
  explanation: string | undefined;
}

// #[derive(Serialize)]
interface ArtifactNotification {
  /// The path of the artifact.
  artifact: string;
  /// What kind of artifact we're emitting.
  emit: string;
}

// #[derive(Serialize)]
interface SectionTimestamp {
  /// Name of the section
  name: string;
  /// Start/end of the section
  event: string;
  /// Opaque timestamp.
  // PORT: `u128` -> bigint.
  timestamp: bigint;
}

// #[derive(Serialize)]
interface FutureBreakageItem {
  // Always EmitTyped::Diagnostic, but we want to make sure it gets serialized
  // with "$message_type".
  diagnostic: EmitTyped;
}

// #[derive(Serialize)]
interface FutureIncompatReport {
  future_incompat_report: FutureBreakageItem[];
}

// NOTE: Keep this in sync with the equivalent structs in rustdoc's
// doctest component (as well as cargo).
// We could unify this struct the one in rustdoc but they have different
// ownership semantics, so doing so would create wasteful allocations.
// #[derive(Serialize)]
interface UnusedExterns {
  /// The severity level of the unused dependencies lint
  lint_level: string;
  /// List of unused externs by their names.
  unused_extern_names: readonly string[];
}

// ---- #[derive(Serialize)] impls -----------------------------------------------------------------
// PORT: what serde's derive generates: struct fields in declaration order (`serialize_struct`),
// `Option` as the value or `null`, fieldless enums (`Applicability`) as their variant name, `&Path`
// as a string, and `#[serde(tag = "$message_type", rename_all = "snake_case")]` as the tag entry
// followed by the variant's struct fields.

function opt<T>(v: T | undefined, f: (v: T) => JsonValue): JsonValue {
  return v === undefined ? null : f(v);
}

function ser_EmitTyped(v: EmitTyped): JsonObject {
  const tagged = (tag: string, o: JsonObject): JsonObject => new JsonObject([["$message_type", tag], ...o.entries]);
  switch (v.$) {
    case "Diagnostic":
      return tagged("diagnostic", ser_Diagnostic(v._0));
    case "Artifact":
      return tagged("artifact", new JsonObject([["artifact", v._0.artifact], ["emit", v._0.emit]]));
    case "SectionTiming":
      return tagged(
        "section_timing",
        new JsonObject([["name", v._0.name], ["event", v._0.event], ["timestamp", v._0.timestamp]]),
      );
    case "FutureIncompat":
      return tagged(
        "future_incompat",
        new JsonObject([
          ["future_incompat_report", v._0.future_incompat_report.map((item) => new JsonObject([["diagnostic", ser_EmitTyped(item.diagnostic)]]))],
        ]),
      );
    case "UnusedExtern":
      return tagged(
        "unused_extern",
        new JsonObject([["lint_level", v._0.lint_level], ["unused_extern_names", [...v._0.unused_extern_names]]]),
      );
  }
}

function ser_Diagnostic(v: Diagnostic): JsonObject {
  return new JsonObject([
    ["message", v.message],
    ["code", opt(v.code, (c) => new JsonObject([["code", c.code], ["explanation", opt(c.explanation, (e) => e)]]))],
    ["level", v.level],
    ["spans", v.spans.map(ser_DiagnosticSpan)],
    ["children", v.children.map(ser_Diagnostic)],
    ["rendered", opt(v.rendered, (r) => r)],
  ]);
}

function ser_DiagnosticSpan(v: DiagnosticSpan): JsonObject {
  return new JsonObject([
    ["file_name", v.file_name],
    ["byte_start", v.byte_start],
    ["byte_end", v.byte_end],
    ["line_start", v.line_start],
    ["line_end", v.line_end],
    ["column_start", v.column_start],
    ["column_end", v.column_end],
    ["is_primary", v.is_primary],
    ["text", v.text.map((l) => new JsonObject([["text", l.text], ["highlight_start", l.highlight_start], ["highlight_end", l.highlight_end]]))],
    ["label", opt(v.label, (l) => l)],
    ["suggested_replacement", opt(v.suggested_replacement, (s) => s)],
    ["suggestion_applicability", opt(v.suggestion_applicability, (a) => a)],
    [
      "expansion",
      opt(
        v.expansion,
        (e) =>
          new JsonObject([
            ["span", ser_DiagnosticSpan(e.span)],
            ["macro_decl_name", e.macro_decl_name],
            ["def_site_span", ser_DiagnosticSpan(e.def_site_span)],
          ]),
      ),
    ],
  ]);
}

// ---- serde_json stand-in -------------------------------------------------------------------------
// PORT: a minimal serde_json (1.x) writer for the values above. `to_writer` = `CompactFormatter`
// (`,` and `:` with no whitespace); `to_writer_pretty` = `PrettyFormatter` with a two-space indent
// (`[`/`{` then each element on its own line, `": "` between key and value, `[]`/`{}` when empty).
// Integers are printed in decimal. Strings use `format_escaped_str`: `"` `\` and the control
// characters U+0000..U+001F are escaped (`\b \t \n \f \r`, others as `\u00xx` with lowercase hex),
// everything else (including U+007F and non-ASCII) is written as is. `JSON.stringify` on a string
// produces exactly that for well-formed Unicode, which every Rust `String` is.

type JsonValue = null | boolean | number | bigint | string | readonly JsonValue[] | JsonObject;

class JsonObject {
  constructor(readonly entries: readonly (readonly [string, JsonValue])[]) {}
}

function json_scalar(v: null | boolean | number | bigint | string): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

/** `serde_json::to_writer` (CompactFormatter), as a string. */
function serde_json_to_string(v: JsonValue): string {
  if (v instanceof JsonObject) {
    return `{${v.entries.map(([k, x]) => `${JSON.stringify(k)}:${serde_json_to_string(x)}`).join(",")}}`;
  }
  if (Array.isArray(v)) {
    return `[${(v as readonly JsonValue[]).map(serde_json_to_string).join(",")}]`;
  }
  return json_scalar(v as null | boolean | number | bigint | string);
}

/** `serde_json::to_writer_pretty` (PrettyFormatter with `b"  "` indent), as a string. */
function serde_json_to_string_pretty(v: JsonValue, indent = ""): string {
  if (v instanceof JsonObject) {
    if (v.entries.length === 0) return "{}";
    const inner = indent + "  ";
    return `{\n${v.entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${serde_json_to_string_pretty(x, inner)}`).join(",\n")}\n${indent}}`;
  }
  if (Array.isArray(v)) {
    const a = v as readonly JsonValue[];
    if (a.length === 0) return "[]";
    const inner = indent + "  ";
    return `[\n${a.map((x) => `${inner}${serde_json_to_string_pretty(x, inner)}`).join(",\n")}\n${indent}]`;
  }
  return json_scalar(v as null | boolean | number | bigint | string);
}
