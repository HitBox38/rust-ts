//! The current rustc diagnostics emitter.
//!
//! An `Emitter` takes care of generating the output from a `Diag` struct.
//!
//! There are various `Emitter` implementations that generate different output formats such as
//! JSON and human readable output.
//!
//! The output types are defined in `rustc_session::config::ErrorOutputType`.
// Port of compiler/rustc_errors/src/emitter.rs.
//
// PORT: representation decisions for this file:
// - `trait Emitter` with provided methods -> the abstract class `Emitter`; implementors `extend`
//   it and override `emit_diagnostic`/`source_map` (and any provided method upstream overrides).
//   `DynEmitter = dyn Emitter + DynSend` is the same class type.
// - `Destination = AutoStream<Box<dyn Write + Send>>` -> the vendored anstream `AutoStream` over a
//   `RawStream` (`dyn_write(w)` is the `Box<dyn Write + Send>`). Output is written as **bytes**;
//   the sink is injectable: `stderr_destination` writes to fd 2, tests pass a `VecU8` buffer.
// - `Buffy`'s `Drop` is not automatic: `drop()` is ported and must be called where upstream drops
//   it; `emit_to_destination` always flushes, so an emitter's `Buffy` is empty between diagnostics.
// - `&mut MultiSpan` / `&mut Vec<Subdiag>` / `&mut Vec<CodeSuggestion>` params are mutated in place.
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { type AsLockedWrite, type FmtArguments, type RawStream, type Stderr, type Write, Write_default, dyn_write, stderr } from "../vendor/anstream/stream.ts";
import { AnsiColor, Effects, Style as Anstyle } from "../vendor/anstyle/lib.ts";
import type { DiagArgMap } from "../rustc_error_messages/lib.ts";
import { DiagMessage, MultiSpan } from "../rustc_error_messages/lib.ts";
import { AstPass, DesugaringKind, ExpnKind, MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { type SourceFile, Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_struct } from "../std/fmt.ts";
import { is_whitespace } from "../std/char.ts";
import { type IoResult } from "../std/io.ts";
import { panic, unwrap } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import { binary_search_by } from "../std/slice.ts";
import { path_strip_prefix } from "../std/path.ts";
import { utf8_len } from "../std/str.ts";
import { format_diag_message } from "./formatting.ts";
import type { TimingRecord } from "./timings.ts";
import type { CodeSuggestion, DiagInner, LintLevel, Style } from "./lib.ts";
import { type Level, Subdiag, Sublevel, SuggestionStyle, display_Level, str_trim } from "./lib.ts";

/// Describes the way the content of the `rendered` field of the json output is generated
export class HumanReadableErrorType {
  constructor(
    public short: boolean,
    public unicode: boolean,
  ) {}

  // rustc: compiler/rustc_errors/src/emitter.rs:41 short
  short_(): boolean {
    // PORT: method `short` clashes with the field of the same name, hence `short_()`.
    return this.short;
  }
}
/** `#[derive(Debug)]` */
export const debug_HumanReadableErrorType: Debug<HumanReadableErrorType> = (v, f) =>
  debug_struct(f, "HumanReadableErrorType", [
    ["short", debug_bool(v.short, f)],
    ["unicode", debug_bool(v.unicode, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function HumanReadableErrorType_eq(a: HumanReadableErrorType, b: HumanReadableErrorType): boolean {
  return a.short === b.short && a.unicode === b.unicode;
}

export type TimingEvent = "Start" | "End";
export const TimingEvent = { Start: "Start", End: "End" } as const;

export type DynEmitter = Emitter;

/** One `(macro_kind, name, diagnostic_opaque, def_site, same_line)` entry of `has_macro_spans`. */
type MacroSpanEntry = [MacroKind, Symbol, boolean, Span, Span | undefined];

/// Emitter trait for emitting errors and other structured information.
export abstract class Emitter {
  /// Emit a structured diagnostic.
  // rustc: compiler/rustc_errors/src/emitter.rs:56 emit_diagnostic
  abstract emit_diagnostic(diag: DiagInner): void;

  /// Emit a notification that an artifact has been output.
  /// Currently only supported for the JSON format.
  // rustc: compiler/rustc_errors/src/emitter.rs:60 emit_artifact_notification
  emit_artifact_notification(_path: string, _artifact_type: string): void {}

  /// Emit a timestamp with start/end of a timing section.
  /// Currently only supported for the JSON format.
  // rustc: compiler/rustc_errors/src/emitter.rs:64 emit_timing_section
  emit_timing_section(_record: TimingRecord, _event: TimingEvent): void {}

  /// Emit a report about future breakage.
  /// Currently only supported for the JSON format.
  // rustc: compiler/rustc_errors/src/emitter.rs:68 emit_future_breakage_report
  emit_future_breakage_report(_diags: DiagInner[]): void {}

  /// Emit list of unused externs.
  /// Currently only supported for the JSON format.
  // rustc: compiler/rustc_errors/src/emitter.rs:72 emit_unused_externs
  emit_unused_externs(_lint_level: LintLevel, _unused_externs: readonly string[]): void {}

  /// Checks if should show explanations about "rustc --explain"
  // rustc: compiler/rustc_errors/src/emitter.rs:80 should_show_explain
  should_show_explain(): boolean {
    return true;
  }

  /// Checks if we can use colors in the current output stream.
  // rustc: compiler/rustc_errors/src/emitter.rs:85 supports_color
  supports_color(): boolean {
    return false;
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:89 source_map
  abstract source_map(): SourceMap | undefined;

  /// Formats the substitutions of the primary_span
  ///
  /// There are a lot of conditions to this method, but in short:
  ///
  /// * If the current `DiagInner` has only one visible `CodeSuggestion`,
  ///   we format the `help` suggestion depending on the content of the
  ///   substitutions. In that case, we modify the span and clear the
  ///   suggestions.
  ///
  /// * If the current `DiagInner` has multiple suggestions,
  ///   we leave `primary_span` and the suggestions untouched.
  // rustc: compiler/rustc_errors/src/emitter.rs:102 primary_span_formatted
  primary_span_formatted(primary_span: MultiSpan, suggestions: CodeSuggestion[], fluent_args: DiagArgMap): void {
    if (suggestions.length > 0) {
      const sugg = suggestions[0]!;
      const rest = suggestions.slice(1);
      const msg = format_diag_message(sugg.msg, fluent_args);
      let part;
      if (
        rest.length === 0 &&
        // ^ if there is only one suggestion
        // don't display multi-suggestions as labels
        sugg.substitutions.length === 1 &&
        // don't display multipart suggestions as labels
        sugg.substitutions[0]!.parts.length === 1 &&
        ((part = sugg.substitutions[0]!.parts[0]!), true) &&
        // don't display long messages as labels
        split_whitespace_count(msg) < 10 &&
        // don't display multiline suggestions as labels
        !part.snippet.includes("\n") &&
        !(<readonly SuggestionStyle[]>[
          // when this style is set we want the suggestion to be a message, not inline
          SuggestionStyle.HideCodeAlways,
          // trivial suggestion for tooling's sake, never shown
          SuggestionStyle.CompletelyHidden,
          // subtle suggestion, never shown inline
          SuggestionStyle.ShowAlways,
        ]).includes(sugg.style)
      ) {
        const snippet = str_trim(part.snippet);
        let msg2: string;
        if (snippet === "" || SuggestionStyle.hide_inline(sugg.style)) {
          // This substitution is only removal OR we explicitly don't want to show the
          // code inline (`hide_inline`). Therefore, we don't show the substitution.
          msg2 = `help: ${msg}`;
        } else {
          // Show the default suggestion text with the substitution
          const sm = this.source_map();
          const span = part.span;
          const confusion_type = sm !== undefined ? detect_confusion_type(sm, snippet, span) : ConfusionType.None;
          msg2 = `help: ${msg}${ConfusionType.label_text(confusion_type)}: \`${snippet}\``;
        }
        primary_span.push_span_label(part.span, msg2);

        // We return only the modified primary_span
        suggestions.length = 0;
      } else {
        // if there are multiple suggestions, print them all in full
        // to be consistent. We could try to figure out if we can
        // make one (or the first one) inline, but that would give
        // undue importance to a semi-random suggestion
      }
    } else {
      // do nothing
    }
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:157 fix_multispans_in_extern_macros_and_render_macro_backtrace
  fix_multispans_in_extern_macros_and_render_macro_backtrace(span: MultiSpan, children: Subdiag[], level: Level, backtrace: boolean): void {
    // Check for spans in macros, before `fix_multispans_in_extern_macros`
    // has a chance to replace them.
    const has_macro_spans: MacroSpanEntry[] = [];
    for (const ms of [span, ...children.map((child) => child.span)]) {
      for (const sp of ms.primary_spans_()) {
        for (const expn_data of Span.macro_backtrace(sp)) {
          switch (expn_data.kind.$) {
            case "Root":
              break;

            // Skip past non-macro entries, just in case there
            // are some which do actually involve macros.
            case "Desugaring":
            case "AstPass":
              break;

            case "Macro": {
              const macro_kind = expn_data.kind._0;
              const name = expn_data.kind._1;
              const same_line = Span.overlaps(sp, expn_data.def_site) ? Span.with_hi(expn_data.def_site, Span.lo(sp)) : undefined;
              has_macro_spans.push([macro_kind, name, expn_data.diagnostic_opaque, expn_data.def_site, same_line]);
              break;
            }
          }
        }
      }
    }

    if (!backtrace) {
      this.fix_multispans_in_extern_macros(span, children);
    }

    this.render_multispans_macro_backtrace(span, children, backtrace);

    const first = has_macro_spans[0];
    const last = has_macro_spans.at(-1);
    if (
      !backtrace &&
      // Skip macros annotated with `#[diagnostic::opaque]`. Builtin macros are "opaque" too.
      first !== undefined &&
      last !== undefined &&
      last[2] === false
    ) {
      const [macro_kind, name, , sp, same_line_span] = first;
      // Mark the actual macro this originates from
      let and_then: string;
      if (last !== undefined && last[1] !== name) {
        const [last_macro_kind, last_name] = last;
        const descr = MacroKind.descr(last_macro_kind);
        and_then = ` which comes from the expansion of the ${descr} \`${Symbol.as_str(last_name)}\``;
      } else {
        and_then = "";
      }

      const descr = MacroKind.descr(macro_kind);
      const msg = `this ${display_Level(level)} originates in the ${descr} \`${Symbol.as_str(name)}\`${and_then}`;

      const source_map = this.source_map();
      if (source_map !== undefined) {
        if (source_map.is_imported(sp) || same_line_span === undefined) {
          const msg2 = `${msg} (in Nightly builds, run with -Z macro-backtrace for more info)`;
          children.push(new Subdiag(Sublevel.Note, [[DiagMessage.from_String(msg2), "NoStyle"]], MultiSpan.new()));
        } else if (same_line_span !== undefined && source_map.is_multiline(same_line_span) && and_then !== "") {
          // We only point at the macro definition when it is not on the same line as the
          // error produced and there are more levels of macro nesting.
          span.push_span_label(sp, msg);
        } else {
          // We point at the macro def line, but without an underline or message, we
          // leave it implied.
          span.push_span_context(Span.shrink_to_lo(sp));
        }
      } else {
        children.push(new Subdiag(Sublevel.Note, [[DiagMessage.from_String(msg), "NoStyle"]], MultiSpan.new()));
      }
    }
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:250 render_multispans_macro_backtrace
  render_multispans_macro_backtrace(span: MultiSpan, children: Subdiag[], backtrace: boolean): void {
    for (const ms of [span, ...children.map((child) => child.span)]) {
      this.render_multispan_macro_backtrace(ms, backtrace);
    }
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:261 render_multispan_macro_backtrace
  render_multispan_macro_backtrace(span: MultiSpan, always_backtrace: boolean): void {
    // PORT: `FxIndexSet<(Span, String)>` -> insertion-ordered Map keyed by the tuple's value.
    const new_labels = new Map<string, [Span, string]>();
    const insert = (label: [Span, string]): void => {
      const key = `${label[0]}\u0000${label[1]}`;
      if (!new_labels.has(key)) new_labels.set(key, label);
    };

    for (const sp of span.primary_spans_()) {
      if (Span.is_dummy(sp)) {
        continue;
      }

      // FIXME(eddyb) use `retain` on `macro_backtrace` to remove all the
      // entries we don't want to print, to make sure the indices being
      // printed are contiguous (or omitted if there's only one entry).
      const macro_backtrace = [...Span.macro_backtrace(sp)];
      const reversed = [...macro_backtrace].reverse();
      for (let i = 0; i < reversed.length; i++) {
        const trace = reversed[i]!;
        if (Span.is_dummy(trace.def_site)) {
          continue;
        }

        if (always_backtrace) {
          insert([
            trace.def_site,
            `in this expansion of \`${ExpnKind.descr(trace.kind)}\`${
              macro_backtrace.length > 1
                ? // if macro_backtrace.len() == 1 it'll be
                  // pointed at by "in this macro invocation"
                  ` (#${i + 1})`
                : ""
            }`,
          ]);
        }

        // Don't add a label on the call site if the diagnostic itself
        // already points to (a part of) that call site, as the label
        // is meant for showing the relevant invocation when the actual
        // diagnostic is pointing to some part of macro definition.
        //
        // This also handles the case where an external span got replaced
        // with the call site span by `fix_multispans_in_extern_macros`.
        //
        // NB: `-Zmacro-backtrace` overrides this, for uniformity, as the
        // "in this expansion of" label above is always added in that mode,
        // and it needs an "in this macro invocation" label to match that.
        const redundant_span = Span.contains(trace.call_site, sp);

        if (!redundant_span || always_backtrace) {
          let msg: string;
          const kind = trace.kind;
          switch (kind.$) {
            case "Macro":
              if (kind._0 === MacroKind.Attr) {
                msg = "this attribute macro expansion";
              } else if (kind._0 === MacroKind.Derive) {
                msg = "this derive macro expansion";
              } else {
                msg = "this macro invocation";
              }
              break;
            case "Root":
              msg = "the crate root";
              break;
            case "AstPass":
              msg = AstPass.descr(kind._0);
              break;
            case "Desugaring":
              msg = `this ${DesugaringKind.descr(kind._0)} desugaring`;
              break;
          }
          insert([
            trace.call_site,
            `in ${msg}${
              macro_backtrace.length > 1 && always_backtrace
                ? // only specify order when the macro
                  // backtrace is multiple levels deep
                  ` (#${i + 1})`
                : ""
            }`,
          ]);
        }
        if (!always_backtrace) {
          break;
        }
      }
    }

    for (const [label_span, label_text] of new_labels.values()) {
      span.push_span_label(label_span, label_text);
    }
  }

  // This does a small "fix" for multispans by looking to see if it can find any that
  // point directly at external macros. Since these are often difficult to read,
  // this will change the span to point at the use site.
  // rustc: compiler/rustc_errors/src/emitter.rs:352 fix_multispans_in_extern_macros
  fix_multispans_in_extern_macros(span: MultiSpan, children: Subdiag[]): void {
    // debug!("fix_multispans_in_extern_macros: before: span={:?} children={:?}", span, children);
    this.fix_multispan_in_extern_macros(span);
    for (const child of children) {
      this.fix_multispan_in_extern_macros(child.span);
    }
    // debug!("fix_multispans_in_extern_macros: after: span={:?} children={:?}", span, children);
  }

  // This "fixes" MultiSpans that contain `Span`s pointing to locations inside of external macros.
  // Since these locations are often difficult to read,
  // we move these spans from the external macros to their corresponding use site.
  // rustc: compiler/rustc_errors/src/emitter.rs:364 fix_multispan_in_extern_macros
  fix_multispan_in_extern_macros(span: MultiSpan): void {
    const source_map = this.source_map();
    if (source_map === undefined) return;
    const should_hide = (span: Span): boolean => {
      if (source_map.is_imported(span)) return true;
      const expn = SyntaxContext.outer_expn_data(Span.data(span).ctxt);
      return expn.diagnostic_opaque && expn.kind.$ === "Macro" && expn.kind._0 === MacroKind.Bang;
    };

    // First, find all the spans in external macros and point instead at their use site.
    const replacements: [Span, Span][] = [];
    for (const sp of [...span.primary_spans_(), ...span.span_labels_().map((sp_label) => sp_label.span)]) {
      const r = ((): [Span, Span] | undefined => {
        if (!Span.is_dummy(sp) && should_hide(sp)) {
          let span = sp;
          let callsite;
          while ((callsite = Span.parent_callsite(span)) !== undefined) {
            span = callsite;
            if (!should_hide(span)) {
              return [sp, span];
            }
          }
        }
        return undefined;
      })();
      if (r !== undefined) replacements.push(r);
    }

    // After we have them, make sure we replace these 'bad' def sites with their use sites.
    for (const [from, to] of replacements) {
      span.replace(from, to);
    }
  }
}

/// An emitter that adds a note to each diagnostic.
export class EmitterWithNote extends Emitter {
  constructor(
    public emitter: Emitter,
    public note: string,
  ) {
    super();
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:407 source_map
  source_map(): SourceMap | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:411 emit_diagnostic
  emit_diagnostic(diag: DiagInner): void {
    diag.sub(Sublevel.Note, this.note, MultiSpan.new());
    this.emitter.emit_diagnostic(diag);
  }
}

export class SilentEmitter extends Emitter {
  // rustc: compiler/rustc_errors/src/emitter.rs:420 source_map
  source_map(): SourceMap | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:424 emit_diagnostic
  emit_diagnostic(_diag: DiagInner): void {}
}

/// Maximum number of suggestions to be shown
///
/// Arbitrary, but taken from trait import suggestion limit
export const MAX_SUGGESTIONS: number = 4;

export type ColorConfig = "Auto" | "Always" | "Never";
export const ColorConfig = {
  Auto: "Auto",
  Always: "Always",
  Never: "Never",

  // rustc: compiler/rustc_errors/src/emitter.rs:440 to_color_choice
  to_color_choice(self: ColorConfig): ColorChoice {
    switch (self) {
      case "Always":
        if (stderr().is_terminal()) {
          return ColorChoice.Always;
        } else {
          return ColorChoice.AlwaysAnsi;
        }
      case "Never":
        return ColorChoice.Never;
      case "Auto":
        if (stderr().is_terminal()) return ColorChoice.Auto;
        return ColorChoice.Never;
    }
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_ColorConfig: Debug<ColorConfig> = (v) => v;

export type OutputTheme = "Ascii" | "Unicode";
export const OutputTheme = { Ascii: "Ascii", Unicode: "Unicode" } as const;
/** `#[derive(Debug)]` */
export const debug_OutputTheme: Debug<OutputTheme> = (v) => v;

// We replace some characters so the CLI output is always consistent and underlines aligned.
// Keep the following list in sync with `rustc_span::char_width`.
// PORT: `(char, &str)` -> `[code point, string]`.
export const OUTPUT_REPLACEMENTS: readonly (readonly [number, string])[] = [
  // In terminals without Unicode support the following will be garbled, but in *all* terminals
  // the underlying codepoint will be as well. We could gate this replacement behind a "unicode
  // support" gate.
  [0x0000, "␀"], // '\0' -> "␀"
  [0x0001, "␁"], // "␁"
  [0x0002, "␂"], // "␂"
  [0x0003, "␃"], // "␃"
  [0x0004, "␄"], // "␄"
  [0x0005, "␅"], // "␅"
  [0x0006, "␆"], // "␆"
  [0x0007, "␇"], // "␇"
  [0x0008, "␈"], // "␈"
  [0x0009, "    "], // We do our own tab replacement
  [0x000b, "␋"], // "␋"
  [0x000c, "␌"], // "␌"
  [0x000d, "␍"], // "␍"
  [0x000e, "␎"], // "␎"
  [0x000f, "␏"], // "␏"
  [0x0010, "␐"], // "␐"
  [0x0011, "␑"], // "␑"
  [0x0012, "␒"], // "␒"
  [0x0013, "␓"], // "␓"
  [0x0014, "␔"], // "␔"
  [0x0015, "␕"], // "␕"
  [0x0016, "␖"], // "␖"
  [0x0017, "␗"], // "␗"
  [0x0018, "␘"], // "␘"
  [0x0019, "␙"], // "␙"
  [0x001a, "␚"], // "␚"
  [0x001b, "␛"], // "␛"
  [0x001c, "␜"], // "␜"
  [0x001d, "␝"], // "␝"
  [0x001e, "␞"], // "␞"
  [0x001f, "␟"], // "␟"
  [0x007f, "␡"], // "␡"
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

// rustc: compiler/rustc_errors/src/emitter.rs:512 normalize_whitespace
export function normalize_whitespace(s: string): string {
  // PORT: the `const { assert!(..sorted..) }` block is a compile-time check; it is the
  // `OUTPUT_REPLACEMENTS is sorted` test in emitter.test.ts.
  // Scan the input string for a character in the ordered table above.
  // If it's present, replace it with its alternative string (it can be more than 1 char!).
  // Otherwise, retain the input char.
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const r = binary_search_by(OUTPUT_REPLACEMENTS, ([k]) => (k < c ? -1 : k > c ? 1 : 0));
    if (r.ok) {
      out += OUTPUT_REPLACEMENTS[r.i]![1];
    } else {
      out += ch;
    }
  }
  return out;
}

export type Destination = AutoStream<RawStream & AsLockedWrite>;

class Buffy implements Write {
  constructor(
    public buffer_writer: Stderr,
    public buffer: number[],
  ) {}

  // rustc: compiler/rustc_errors/src/emitter.rs:544 write
  write(buf: Uint8Array): IoResult<number> {
    // `self.buffer.write(buf)` (`impl Write for Vec<u8>` appends everything)
    for (const b of buf) this.buffer.push(b);
    return Ok(buf.length);
  }

  // rustc: compiler/rustc_errors/src/emitter.rs:548 flush
  flush(): IoResult<void> {
    const r = this.buffer_writer.write_all(Uint8Array.from(this.buffer));
    if (r.$ === "Err") return r;
    this.buffer.length = 0;
    return Ok(undefined);
  }

  /** `std::io::Write` provided method. */
  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }

  /** `std::io::Write` provided method. */
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }

  // impl Drop for Buffy
  // rustc: compiler/rustc_errors/src/emitter.rs:556 drop
  drop(): void {
    if (this.buffer.length !== 0) {
      unwrap(this.flush());
      panic("buffers need to be flushed in order to print their contents");
    }
  }
}

// rustc: compiler/rustc_errors/src/emitter.rs:564 stderr_destination
export function stderr_destination(color: ColorConfig): Destination {
  const buffer_writer = stderr();
  // We need to resolve `ColorChoice::Auto` before `Box`ing since
  // `ColorChoice::Auto` on `dyn Write` will always resolve to `Never`
  const choice = get_stderr_color_choice(color, buffer_writer);
  // On Windows we'll be performing global synchronization on the entire
  // system for emitting rustc errors, so there's no need to buffer
  // anything.
  //
  // On non-Windows we rely on the atomicity of `write` to ensure errors
  // don't get all jumbled up.
  // PORT: `cfg!(windows)` is the host rust-ts runs on (the oracle runs on the same host).
  if (process.platform === "win32") {
    return AutoStream.new(dyn_write(buffer_writer), choice);
  } else {
    const buffer: number[] = [];
    return AutoStream.new(dyn_write(new Buffy(buffer_writer, buffer)), choice);
  }
}

// rustc: compiler/rustc_errors/src/emitter.rs:583 get_stderr_color_choice
export function get_stderr_color_choice(color: ColorConfig, stderr: Stderr): ColorChoice {
  const choice = ColorConfig.to_color_choice(color);
  if (choice === ColorChoice.Auto) {
    return AutoStream.choice(stderr);
  } else {
    return choice;
  }
}

// impl Style
// rustc: compiler/rustc_errors/src/emitter.rs:589 anstyle
export function Style_anstyle(self: Style): Anstyle {
  // PORT: lives on the `Style` companion const (lib.ts spreads it in as `Style.anstyle`).
  switch (self) {
    case "NoStyle":
      return Anstyle.new();
    case "Highlight":
      return Anstyle.effects(AnsiColor.on_default("Magenta"), Effects.BOLD);
  }
}

/// Whether the original and suggested code are the same.
// rustc: compiler/rustc_errors/src/emitter.rs:598 is_different
export function is_different(sm: SourceMap, suggested: string, sp: Span): boolean {
  const r = sm.span_to_snippet(sp);
  let found: string;
  if (r.$ === "Ok") {
    found = r._0.toString();
  } else {
    // warn!(error = ?e, "Invalid span {:?}", sp);
    return true;
  }
  return found !== suggested;
}

/// Whether the original and suggested code are visually similar enough to warrant extra wording.
// rustc: compiler/rustc_errors/src/emitter.rs:610 detect_confusion_type
export function detect_confusion_type(sm: SourceMap, suggested: string, sp: Span): ConfusionType {
  const r = sm.span_to_snippet(sp);
  let found: string;
  if (r.$ === "Ok") {
    found = r._0.toString();
  } else {
    // warn!(error = ?e, "Invalid span {:?}", sp);
    return ConfusionType.None;
  }

  let has_case_confusion = false;
  let has_digit_letter_confusion = false;

  if (utf8_len(found) === utf8_len(suggested)) {
    let has_case_diff = false;
    let has_digit_letter_confusable = false;
    let has_other_diff = false;

    // Letters whose lowercase version is very similar to the uppercase
    // version.
    const ascii_confusables = ["c", "f", "i", "k", "o", "s", "u", "v", "w", "x", "y", "z"];

    const digit_letter_confusables: [string, string][] = [
      ["0", "O"],
      ["1", "l"],
      ["5", "S"],
      ["8", "B"],
      ["9", "g"],
    ];
    const pair_in = (a: string, b: string): boolean => digit_letter_confusables.some(([x, y]) => x === a && y === b);

    const fc = Array.from(found);
    const sc = Array.from(suggested);
    const n = Math.min(fc.length, sc.length);
    for (let i = 0; i < n; i++) {
      const f = fc[i]!;
      const s = sc[i]!;
      if (f !== s) {
        if (eq_ignore_ascii_case(f, s)) {
          // Check for case differences (any character that differs only in case)
          if (ascii_confusables.includes(f) || ascii_confusables.includes(s)) {
            has_case_diff = true;
          } else {
            has_other_diff = true;
          }
        } else if (pair_in(f, s) || pair_in(s, f)) {
          // Check for digit-letter confusables (like 0 vs O, 1 vs l, etc.)
          has_digit_letter_confusable = true;
        } else {
          has_other_diff = true;
        }
      }
    }

    // If we have case differences and no other differences
    if (has_case_diff && !has_other_diff && found !== suggested) {
      has_case_confusion = true;
    }
    if (has_digit_letter_confusable && !has_other_diff && found !== suggested) {
      has_digit_letter_confusion = true;
    }
  }

  if (has_case_confusion && has_digit_letter_confusion) return ConfusionType.Both;
  if (has_case_confusion && !has_digit_letter_confusion) return ConfusionType.Case;
  if (!has_case_confusion && has_digit_letter_confusion) return ConfusionType.DigitLetter;
  return ConfusionType.None;
}

/// Represents the type of confusion detected between original and suggested code.
export type ConfusionType =
  /// No confusion detected
  | "None"
  /// Only case differences (e.g., "hello" vs "Hello")
  | "Case"
  /// Only digit-letter confusion (e.g., "0" vs "O", "1" vs "l")
  | "DigitLetter"
  /// Both case and digit-letter confusion
  | "Both";
export const ConfusionType = {
  None: "None",
  Case: "Case",
  DigitLetter: "DigitLetter",
  Both: "Both",

  /// Returns the appropriate label text for this confusion type.
  // rustc: compiler/rustc_errors/src/emitter.rs:685 label_text
  label_text(self: ConfusionType): string {
    switch (self) {
      case "None":
        return "";
      case "Case":
        return " (notice the capitalization)";
      case "DigitLetter":
        return " (notice the digit/letter confusion)";
      case "Both":
        return " (notice the capitalization and digit/letter confusion)";
    }
  },

  /// Combines two confusion types. If either is `Both`, the result is `Both`.
  /// If one is `Case` and the other is `DigitLetter`, the result is `Both`.
  /// Otherwise, returns the non-`None` type, or `None` if both are `None`.
  // rustc: compiler/rustc_errors/src/emitter.rs:697 combine
  combine(self: ConfusionType, other: ConfusionType): ConfusionType {
    if (self === "None") return other;
    if (other === "None") return self;
    if (self === "Both" || other === "Both") return "Both";
    if ((self === "Case" && other === "DigitLetter") || (self === "DigitLetter" && other === "Case")) return "Both";
    if (self === "Case" && other === "Case") return "Case";
    // (DigitLetter, DigitLetter)
    return "DigitLetter";
  },

  /// Returns true if this confusion type represents any kind of confusion.
  // rustc: compiler/rustc_errors/src/emitter.rs:710 has_confusion
  has_confusion(self: ConfusionType): boolean {
    return self !== "None";
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_ConfusionType: Debug<ConfusionType> = (v) => v;

// rustc: compiler/rustc_errors/src/emitter.rs:715 should_show_source_code
export function should_show_source_code(ignored_directories: readonly string[], sm: SourceMap, file: SourceFile): boolean {
  if (!sm.ensure_source_file_source_present(file)) {
    return false;
  }

  if (file.name.$ !== "Real") return true;
  const name = file.name._0;
  const path = name.local_path();
  // `path.starts_with(dir)` is component-wise (`Path::starts_with` = `strip_prefix(..).is_ok()`).
  return path !== undefined ? ignored_directories.every((dir) => path_strip_prefix(path, dir) === undefined) : true;
}

// ---- helpers (std / other-crate pieces used above) ------------------------------------------------

/** `str::split_whitespace().count()` (splits on `char::is_whitespace`, skipping empty pieces). */
function split_whitespace_count(s: string): number {
  let count = 0;
  let in_word = false;
  for (const ch of s) {
    if (is_whitespace(ch.codePointAt(0)!)) {
      in_word = false;
    } else if (!in_word) {
      in_word = true;
      count++;
    }
  }
  return count;
}

/** `char::eq_ignore_ascii_case` on single-char strings. */
function eq_ignore_ascii_case(a: string, b: string): boolean {
  const lower = (c: string): string => (c.length === 1 && c >= "A" && c <= "Z" ? c.toLowerCase() : c);
  return lower(a) === lower(b);
}
