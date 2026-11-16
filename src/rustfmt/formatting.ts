// High level formatting functions.
// Port of src/tools/rustfmt/src/formatting.rs (lane rustfmt-contract-3).
//
// PORT (load order): `impl Session` (formatting.rs:30) and `impl FormatHandler for Session` (:283) add methods to lib.ts's
// `Session`. lib.ts is the crate root and imports this module, so this module's body runs before lib.ts's whenever lib.ts
// loads first, and an assignment to `Session.prototype` here would hit the class in its TDZ. So the two methods are function
// declarations here (initialised when the module is instantiated, before any body runs) and lib.ts assigns them onto
// `Session.prototype` right after the class. This module's top level touches no binding of lib.ts.
import "./config/mod.ts";
import { type Config, Edition, type FileName, clone_Config } from "./config/mod.ts";
import { FileName_eq, clone_FileName, display_FileName, key_FileName } from "./config/file_lines.ts";
import { apply_newline_style } from "./formatting/newline_style.ts";
import { CharClasses, FullCodeCharKind } from "../rustfmt/comment.ts";
import { is_generated_file } from "./formatting/generated.ts";
import { type FileModMap, type Module, ModResolver } from "../rustfmt/modules.ts";
import { DirectoryOwnership, Parser, type ParserError } from "../rustfmt/parse/parser.ts";
import { ParseSess } from "../rustfmt/parse/session.ts";
import { contains_skip, count_newlines } from "../rustfmt/utils.ts";
import { FmtVisitor } from "../rustfmt/visitor.ts";
import { ErrorKind, FormatReport, Input, type Session, type Write, clone_FormatReport } from "./lib.ts";
import { append_newline, write_file } from "../rustfmt/source_file.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { Span, create_session_if_not_set_then } from "../rustc_span/lib.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { type Debug, debug_bool, debug_struct } from "../std/fmt.ts";
import { IoError_kind, display_IoError, stdout_write_all, write_stderr, write_stdout } from "../std/io.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { string_trim_end, utf8_len } from "../std/str.ts";
import { is_whitespace } from "../std/char.ts";
import { type Duration, Instant } from "../std/time.ts";

// A map of the files of a crate, with their new content
export type SourceFile = FileRecord[];
export type FileRecord = [FileName, string];

declare module "./lib.ts" {
  interface Session<T extends Write = Write> {
    // `impl<'b, T: Write + 'b> Session<'b, T>` (formatting.rs:30)
    format_input_inner(input: Input, is_macro_def: boolean): Result<FormatReport, ErrorKind>;
    // `impl<'b, T: Write + 'b> FormatHandler for Session<'b, T>` (formatting.rs:283)
    handle_formatted_file(psess: ParseSess, path: FileName, result: string, report: FormatReport): Result<null, ErrorKind>;
  }
}

// `impl<'b, T: Write + 'b> Session<'b, T>`
// rustc: src/tools/rustfmt/src/formatting.rs:31 format_input_inner
export function format_input_inner<T extends Write>(this: Session<T>, input: Input, is_macro_def: boolean): Result<FormatReport, ErrorKind> {
  if (!this.config.version_meets_requirement()) {
    return Err(ErrorKind.VersionMismatch);
  }

  return create_session_if_not_set_then(Edition.into_rustc_span(this.config.edition()), (_) => {
    if (this.config.disable_all_formatting()) {
      // When the input is from stdin, echo back the input.
      switch (input.$) {
        case "Text":
          return echo_back_stdin(input._0);
        default:
          return Ok(FormatReport.new());
      }
    }

    const config = clone_Config(this.config);
    const format_result = format_project(input, config, this, is_macro_def);

    // `format_result.map(|report| { self.errors.add(&report.internal.borrow().1); report })`
    if (format_result.$ === "Ok") {
      const report = format_result._0;
      this.errors.add(report.internal[1]);
    }
    return format_result;
  });
}

/// Determine if a module should be skipped. True if the module should be skipped, false otherwise.
// rustc: src/tools/rustfmt/src/formatting.rs:61 should_skip_module
function should_skip_module<T extends FormatHandler>(
  config: Config,
  context: FormatContext<T>,
  input_is_stdin: boolean,
  main_file: FileName,
  path: FileName,
  module: Module,
): boolean {
  if (contains_skip(module.attrs())) {
    return true;
  }

  if (config.skip_children() && !FileName_eq(path, main_file)) {
    return true;
  }

  if (!input_is_stdin && context.ignore_file(path)) {
    return true;
  }

  // FIXME(calebcartwright) - we need to determine how we'll handle the
  // `format_generated_files` option with stdin based input.
  if (!input_is_stdin && !config.format_generated_files()) {
    const source_file = context.psess.span_to_file_contents(module.span);
    if (source_file.src === undefined) panic("SourceFile without src");
    const src = source_file.src.toString();

    if (is_generated_file(src, config)) {
      return true;
    }
  }

  return false;
}

// rustc: src/tools/rustfmt/src/formatting.rs:95 echo_back_stdin
function echo_back_stdin(input: string): Result<FormatReport, ErrorKind> {
  // `io::stdout().write_all(input.as_bytes())`: the raw handle, which `set_output_capture` does not capture (as upstream).
  const r = stdout_write_all(new TextEncoder().encode(input));
  if (r.$ === "Err") {
    return Err(ErrorKind.from(r._0));
  }
  return Ok(FormatReport.new());
}

// Format an entire crate (or subset of the module tree).
// rustc: src/tools/rustfmt/src/formatting.rs:103 format_project
function format_project<T extends FormatHandler>(
  input: Input,
  config: Config,
  handler: T,
  is_macro_def: boolean,
): Result<FormatReport, ErrorKind> {
  let timer = Timer.start();

  const main_file = Input.file_name(input);
  const input_is_stdin = main_file.$ === "Stdin";

  const psess_r = ParseSess.new(config);
  if (psess_r.$ === "Err") return Err(psess_r._0);
  const psess = psess_r._0;
  if (config.skip_children() && psess.ignore_file(main_file)) {
    return Ok(FormatReport.new());
  }

  // Parse the crate.
  const report = FormatReport.new();
  const directory_ownership = Input.to_directory_ownership(input);

  const krate_r = Parser.parse_crate(input, psess);
  let krate: Crate;
  if (krate_r.$ === "Ok") {
    krate = krate_r._0;
  } else {
    // Surface parse error via Session (errors are merged there from report)
    const e: ParserError = krate_r._0;
    const forbid_verbose = input_is_stdin || e !== "ParsePanicError";
    should_emit_verbose(forbid_verbose, config, () => {
      write_stderr("The Rust parser panicked\n");
    });
    report.add_parsing_error();
    return Ok(report);
  }

  const context = FormatContext.new(krate, report, psess, config, handler);
  const visited = ModResolver.new(
    context.psess,
    directory_ownership ?? DirectoryOwnership.UnownedViaBlock,
    !input_is_stdin && !config.skip_children(),
  ).visit_crate(krate);
  if (visited.$ === "Err") return Err(ErrorKind.from_ModuleResolutionError(visited._0));
  const file_mod_map: FileModMap = visited._0;
  const files = [...file_mod_map].filter(
    ([path, module]) => input_is_stdin || !should_skip_module(config, context, input_is_stdin, main_file, path, module),
  );

  timer = Timer.done_parsing(timer);

  // Suppress error output if we have to do any further parsing.
  context.psess.set_silent_emitter();

  for (const [path, module] of files) {
    if (input_is_stdin && contains_skip(module.attrs())) {
      return echo_back_stdin(context.psess.snippet_provider(module.span).entire_snippet());
    }
    should_emit_verbose(input_is_stdin, config, () => write_stdout(`Formatting ${display_FileName(path)}\n`));
    const r = context.format_file(path, module, is_macro_def);
    if (r.$ === "Err") return r;
  }
  timer = Timer.done_formatting(timer);

  should_emit_verbose(input_is_stdin, config, () => {
    write_stdout(
      `Spent ${f32_fixed3(Timer.get_parse_time(timer))} secs in the parsing phase, and ${f32_fixed3(Timer.get_format_time(timer))} secs in the formatting phase\n`,
    );
  });

  return Ok(context.report);
}

// Used for formatting files.
class FormatContext<T extends FormatHandler> {
  constructor(
    public krate: Crate,
    public report: FormatReport,
    public psess: ParseSess,
    public config: Config,
    public handler: T,
  ) {}

  // rustc: src/tools/rustfmt/src/formatting.rs:185 new
  static new<T extends FormatHandler>(krate: Crate, report: FormatReport, psess: ParseSess, config: Config, handler: T): FormatContext<T> {
    return new FormatContext(krate, report, psess, config, handler);
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:201 ignore_file
  ignore_file(path: FileName): boolean {
    return this.psess.ignore_file(path);
  }

  // Formats a single file/module.
  // rustc: src/tools/rustfmt/src/formatting.rs:206 format_file
  format_file(path: FileName, module: Module, is_macro_def: boolean): Result<null, ErrorKind> {
    const snippet_provider = this.psess.snippet_provider(module.span);
    const visitor = FmtVisitor.from_psess(this.psess, this.config, snippet_provider, clone_FormatReport(this.report));
    try {
      visitor.skip_context.update_with_attrs(this.krate.attrs);
      visitor.is_macro_def = is_macro_def;
      visitor.last_pos = snippet_provider.start_pos();
      visitor.skip_empty_lines(snippet_provider.end_pos());
      visitor.format_separate_mod(module, snippet_provider.end_pos());

      // debug_assert_eq!(
      //     visitor.line_number,
      //     count_newlines(&visitor.buffer),
      //     "failed in format_file visitor.buffer:\n {:?}",
      //     &visitor.buffer
      // );

      const buffer: MutRef<string> = field_mut(visitor, "buffer");

      // For some reason, the source_map does not include terminating
      // newlines so we must add one on for each file. This is sad.
      const num_newlines = count_newlines(visitor.buffer);
      if (this.config.file_lines().contains_line(path, num_newlines + 1)) {
        append_newline(buffer);
      }

      format_lines(buffer, path, visitor.skipped_range, this.config, this.report);

      apply_newline_style(this.config.newline_style(), buffer, snippet_provider.entire_snippet());

      if (visitor.macro_rewrite_failure) {
        this.report.add_macro_format_failure();
      }
      this.report.add_non_formatted_ranges(visitor.skipped_range.map(([lo, hi]): [number, number] => [lo, hi]));

      return this.handler.handle_formatted_file(this.psess, path, visitor.buffer, this.report);
    } finally {
      // PORT: `visitor` leaves scope here (`impl Drop for FmtVisitor`, visitor.rs:95), on return and on unwind.
      visitor.drop();
    }
  }
}

// Handle the results of formatting.
interface FormatHandler {
  // rustc: src/tools/rustfmt/src/formatting.rs:274 handle_formatted_file
  handle_formatted_file(psess: ParseSess, path: FileName, result: string, report: FormatReport): Result<null, ErrorKind>;
}

// `impl<'b, T: Write + 'b> FormatHandler for Session<'b, T>`
// Called for each formatted file.
// rustc: src/tools/rustfmt/src/formatting.rs:285 handle_formatted_file
export function handle_formatted_file<T extends Write>(
  this: Session<T>,
  psess: ParseSess,
  path: FileName,
  result: string,
  report: FormatReport,
): Result<null, ErrorKind> {
  const out = this.out;
  if (out !== undefined) {
    const r = write_file(psess, path, result, out, this.emitter, this.config.newline_style());
    if (r.$ === "Ok") {
      if (r._0.has_diff) report.add_diff();
    } else {
      const e = r._0;
      // Create a new error with path_str to help users see which files failed
      const err_msg = `${display_FileName(path)}: ${display_IoError(e)}`;
      // `io::Error::new(e.kind(), err_msg).into()`
      return Err(ErrorKind.from({ $: "Custom", kind: IoError_kind(e), error: err_msg }));
    }
  }

  this.source_file.push([path, result]);
  return Ok(null);
}

export class FormattingError {
  constructor(
    public line: number,
    public kind: ErrorKind,
    public is_comment: boolean,
    public is_string: boolean,
    public line_buffer: string,
    /// The byte range within `line_buffer` that the error should highlight
    // `Option<Range<usize>>`
    public highlight: { start: number; end: number } | undefined,
  ) {}

  // rustc: src/tools/rustfmt/src/formatting.rs:327 from_span
  static from_span(span: Span, psess: ParseSess, kind: ErrorKind): FormattingError {
    return new FormattingError(
      psess.line_of_byte_pos(Span.lo(span)),
      kind,
      ErrorKind.is_comment(kind),
      false,
      psess.span_to_first_line_string(span),
      undefined,
    );
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:338 is_internal
  is_internal(): boolean {
    switch (this.kind.$) {
      case "LineOverflow":
      case "TrailingWhitespace":
      case "IoError":
      case "ParseError":
      case "LostComment":
        return true;
      default:
        return false;
    }
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:349 msg_suffix
  msg_suffix(): string | undefined {
    if (this.is_comment || this.is_string) {
      return "set `error_on_unformatted = false` to suppress " + "the warning against comments or string literals";
    } else {
      return undefined;
    }
  }
}

export type FormatErrorMap = KeyedMap<FileName, FormattingError[]>;
/** A new `HashMap<FileName, Vec<FormattingError>>`. PORT: keyed by `FileName`'s value (`key_FileName`, config/file_lines.ts);
 *  iterated in insertion order, one of the orders std's `RandomState` map can produce (as rustfmt-contract-1's PORT 2). */
export function new_FormatErrorMap(): FormatErrorMap {
  return new KeyedMap<FileName, FormattingError[]>(key_FileName);
}

// `#[derive(Default, Debug, PartialEq)]`
export class ReportedErrors {
  constructor(
    // Encountered e.g., an IO error.
    public has_operational_errors: boolean,

    // Failed to reformat code because of parsing errors.
    public has_parsing_errors: boolean,

    // Code is valid, but it is impossible to format it properly.
    public has_formatting_errors: boolean,

    // Code contains macro call that was unable to format.
    public has_macro_format_failure: boolean,

    // Failed an opt-in checking.
    public has_check_errors: boolean,

    /// Formatted code differs from existing code (--check only).
    public has_diff: boolean,

    /// Formatted code missed something, like lost comments or extra trailing space
    public has_unformatted_code_errors: boolean,
  ) {}

  /// Combine two summaries together.
  // rustc: src/tools/rustfmt/src/formatting.rs:389 add
  add(other: ReportedErrors): void {
    this.has_operational_errors ||= other.has_operational_errors;
    this.has_parsing_errors ||= other.has_parsing_errors;
    this.has_formatting_errors ||= other.has_formatting_errors;
    this.has_macro_format_failure ||= other.has_macro_format_failure;
    this.has_check_errors ||= other.has_check_errors;
    this.has_diff ||= other.has_diff;
    this.has_unformatted_code_errors ||= other.has_unformatted_code_errors;
  }
}

/** `#[derive(Default)]` of `ReportedErrors`. */
export function default_ReportedErrors(): ReportedErrors {
  return new ReportedErrors(false, false, false, false, false, false, false);
}

/** `#[derive(Debug)]` of `ReportedErrors`. */
export const debug_ReportedErrors: Debug<ReportedErrors> = (v, f) =>
  debug_struct(f, "ReportedErrors", [
    ["has_operational_errors", debug_bool(v.has_operational_errors, f)],
    ["has_parsing_errors", debug_bool(v.has_parsing_errors, f)],
    ["has_formatting_errors", debug_bool(v.has_formatting_errors, f)],
    ["has_macro_format_failure", debug_bool(v.has_macro_format_failure, f)],
    ["has_check_errors", debug_bool(v.has_check_errors, f)],
    ["has_diff", debug_bool(v.has_diff, f)],
    ["has_unformatted_code_errors", debug_bool(v.has_unformatted_code_errors, f)],
  ]);

/** `#[derive(PartialEq)]` of `ReportedErrors`. */
export function ReportedErrors_eq(a: ReportedErrors, b: ReportedErrors): boolean {
  return (
    a.has_operational_errors === b.has_operational_errors &&
    a.has_parsing_errors === b.has_parsing_errors &&
    a.has_formatting_errors === b.has_formatting_errors &&
    a.has_macro_format_failure === b.has_macro_format_failure &&
    a.has_check_errors === b.has_check_errors &&
    a.has_diff === b.has_diff &&
    a.has_unformatted_code_errors === b.has_unformatted_code_errors
  );
}

// `#[derive(Clone, Copy, Debug)]`
// PORT: the derived `Debug` is not written: nothing prints a `Timer`, and src/std has no `Debug` for `Instant`.
type Timer =
  | { readonly $: "Disabled" }
  | { readonly $: "Initialized"; _0: Instant }
  | { readonly $: "DoneParsing"; _0: Instant; _1: Instant }
  | { readonly $: "DoneFormatting"; _0: Instant; _1: Instant; _2: Instant };
const Timer = {
  Disabled: Object.freeze({ $: "Disabled" as const }) as Timer,

  // rustc: src/tools/rustfmt/src/formatting.rs:409 start
  start(): Timer {
    // `cfg!(target_arch = "wasm32")`: false (the oracle is a native build).
    const target_arch_wasm32: boolean = false;
    if (target_arch_wasm32) {
      return Timer.Disabled;
    } else {
      return { $: "Initialized", _0: Instant.now() };
    }
  },

  // rustc: src/tools/rustfmt/src/formatting.rs:416 done_parsing
  done_parsing(self: Timer): Timer {
    switch (self.$) {
      case "Disabled":
        return Timer.Disabled;
      case "Initialized":
        return { $: "DoneParsing", _0: self._0, _1: Instant.now() };
      default:
        return panic("Timer can only transition to DoneParsing from Initialized state");
    }
  },

  // rustc: src/tools/rustfmt/src/formatting.rs:424 done_formatting
  done_formatting(self: Timer): Timer {
    switch (self.$) {
      case "Disabled":
        return Timer.Disabled;
      case "DoneParsing":
        return { $: "DoneFormatting", _0: self._0, _1: self._1, _2: Instant.now() };
      default:
        return panic("Timer can only transition to DoneFormatting from DoneParsing state");
    }
  },

  /// Returns the time it took to parse the source files in seconds.
  // rustc: src/tools/rustfmt/src/formatting.rs:435 get_parse_time
  get_parse_time(self: Timer): number {
    switch (self.$) {
      case "Disabled":
        return panic("this platform cannot time execution");
      case "DoneParsing":
      case "DoneFormatting": {
        const init = self._0;
        const parse_time = self._1;
        // This should never underflow since `Instant::now()` guarantees monotonicity.
        return Timer.duration_to_f32(parse_time.duration_since(init));
      }
      case "Initialized":
        return unreachable();
    }
  },

  /// Returns the time it took to go from the parsed AST to the formatted output. Parsing time is
  /// not included.
  // rustc: src/tools/rustfmt/src/formatting.rs:448 get_format_time
  get_format_time(self: Timer): number {
    switch (self.$) {
      case "Disabled":
        return panic("this platform cannot time execution");
      case "DoneFormatting": {
        const parse_time = self._1;
        const format_time = self._2;
        return Timer.duration_to_f32(format_time.duration_since(parse_time));
      }
      case "DoneParsing":
      case "Initialized":
        return unreachable();
    }
  },

  // rustc: src/tools/rustfmt/src/formatting.rs:458 duration_to_f32
  duration_to_f32(d: Duration): number {
    // `d.as_secs() as f32 + d.subsec_nanos() as f32 / 1_000_000_000f32`, each step rounded to f32 (`Math.fround`; an f32
    // `/` or `+` computed in f64 and then rounded is the correctly rounded f32 result).
    const secs = Math.fround(Number(d.as_secs()));
    const frac = Math.fround(Math.fround(d.subsec_nanos()) / Math.fround(1_000_000_000));
    return Math.fround(secs + frac);
  },
};

/** `format!("{:.3}", v)` for a finite, non-negative `f32` (`<f32 as Display>::fmt` with precision 3): the exact decimal
 *  value rounded to three fractional digits, ties to even (`float_to_decimal_common_exact`).
 *  PORT: src/std's fmt.ts models only precision 1 for f64 (`f64_fixed1`); this is the same exact BigInt rounding at
 *  precision 3. An f32 value held in an f64 is exact, so rounding the f64 rounds the f32. A candidate for src/std. */
function f32_fixed3(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const m = exp === 0 ? frac : frac | (1n << 52n);
  const e = (exp === 0 ? 1 : exp) - 1075;
  // x * 1000 = m * 1000 * 2^e, rounded to an integer, ties to even.
  let q: bigint;
  if (e >= 0) {
    q = m * 1000n * (1n << BigInt(e));
  } else {
    const num = m * 1000n;
    const den = 1n << BigInt(-e);
    q = num / den;
    const r2 = (num % den) * 2n;
    if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  }
  return `${q / 1000n}.${(q % 1000n).toString().padStart(3, "0")}`;
}

// Formatting done on a char by char or line by line basis.
// FIXME(#20): other stuff for parity with make tidy.
// rustc: src/tools/rustfmt/src/formatting.rs:465 format_lines
function format_lines(
  text: MutRef<string>,
  name: FileName,
  skipped_range: readonly [number, number][],
  config: Config,
  report: FormatReport,
): void {
  const formatter = FormatLines.new(name, skipped_range, config);
  formatter.iterate(text.value);

  if (formatter.newline_count > 1) {
    // debug!("track truncate: {} {}", text.len(), formatter.newline_count);
    const line = utf8_len(text.value) - formatter.newline_count + 1;
    // `text.truncate(line)`: drops the last `newline_count - 1` bytes. They lie in the text's trailing run of '\n' and '\r'
    // (`char` resets `newline_count`, and '\r' is skipped), which holds at least `newline_count` bytes, all ASCII, so the
    // cut is the same number of UTF-16 units from the end.
    text.value = text.value.slice(0, text.value.length - (utf8_len(text.value) - line));
  }

  report.append(clone_FileName(name), formatter.errors);
}

class FormatLines {
  constructor(
    public name: FileName,
    public skipped_range: readonly [number, number][],
    public whitespace_start: number | undefined,
    public overflow_start: number | undefined,
    public line_len: number,
    public cur_line: number,
    public newline_count: number,
    public errors: FormattingError[],
    public line_buffer: string,
    public current_line_contains_string_literal: boolean,
    public format_line: boolean,
    public config: Config,
  ) {}

  // rustc: src/tools/rustfmt/src/formatting.rs:500 new
  static new(name: FileName, skipped_range: readonly [number, number][], config: Config): FormatLines {
    return new FormatLines(
      name,
      skipped_range,
      undefined,
      undefined,
      0,
      1,
      0,
      [],
      // `String::with_capacity(config.max_width() * 2)`: capacity is not modelled.
      "",
      false,
      config.file_lines().contains_line(name, 1),
      config,
    );
  }

  // Iterate over the chars in the file map.
  // PORT: upstream takes `&mut String` but only reads it.
  // rustc: src/tools/rustfmt/src/formatting.rs:522 iterate
  iterate(text: string): void {
    for (const [kind, c] of CharClasses.new(string_chars(text))) {
      if (c === 0x0d /* '\r' */) {
        continue;
      }

      if (c === 0x0a /* '\n' */) {
        this.new_line(kind);
      } else {
        this.char(c, kind);
      }
    }
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:536 new_line
  new_line(kind: FullCodeCharKind): void {
    if (this.format_line) {
      // Check for (and record) trailing whitespace.
      const whitespace_start = this.whitespace_start;
      if (whitespace_start !== undefined) {
        if (this.should_report_error(kind, ErrorKind.TrailingWhitespace) && !this.is_skipped_line()) {
          this.push_err(ErrorKind.TrailingWhitespace, FullCodeCharKind.is_comment(kind), FullCodeCharKind.is_string(kind), {
            start: utf8_len(string_trim_end(this.line_buffer)),
            end: utf8_len(this.line_buffer),
          });
        }
        this.line_len = whitespace_start;
      }

      // Check for any line width errors we couldn't correct.
      const error_kind: ErrorKind = { $: "LineOverflow", _0: this.line_len, _1: this.config.max_width() };
      if (this.line_len > this.config.max_width() && !this.is_skipped_line() && this.should_report_error(kind, error_kind)) {
        const is_string = this.current_line_contains_string_literal;
        const overflow_start = this.overflow_start;
        if (overflow_start === undefined) panic("overflow_start is set whenever the line exceeds max_width");
        const highlight = { start: overflow_start, end: utf8_len(string_trim_end(this.line_buffer)) };
        this.push_err(error_kind, FullCodeCharKind.is_comment(kind), is_string, highlight);
      }
    }

    this.line_len = 0;
    this.cur_line += 1;
    this.format_line = this.config.file_lines().contains_line(this.name, this.cur_line);
    this.newline_count += 1;
    this.whitespace_start = undefined;
    this.overflow_start = undefined;
    this.line_buffer = "";
    this.current_line_contains_string_literal = false;
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:581 char
  char(c: number, kind: FullCodeCharKind): void {
    this.newline_count = 0;
    if (!is_whitespace(c)) {
      this.whitespace_start = undefined;
    } else if (this.whitespace_start === undefined) {
      this.whitespace_start = this.line_len;
    }
    this.line_len += c === 0x09 /* '\t' */ ? this.config.tab_spaces() : 1;
    if (this.line_len > this.config.max_width() && this.overflow_start === undefined) {
      this.overflow_start = utf8_len(this.line_buffer);
    }
    this.line_buffer += String.fromCodePoint(c);
    if (FullCodeCharKind.is_string(kind)) {
      this.current_line_contains_string_literal = true;
    }
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:602 push_err
  push_err(kind: ErrorKind, is_comment: boolean, is_string: boolean, highlight: { start: number; end: number }): void {
    this.errors.push(new FormattingError(this.cur_line, kind, is_comment, is_string, this.line_buffer, highlight));
  }

  // rustc: src/tools/rustfmt/src/formatting.rs:619 should_report_error
  should_report_error(char_kind: FullCodeCharKind, error_kind: ErrorKind): boolean {
    let allow_error_report: boolean;
    if (FullCodeCharKind.is_comment(char_kind) || this.current_line_contains_string_literal || ErrorKind.is_comment(error_kind)) {
      allow_error_report = this.config.error_on_unformatted();
    } else {
      allow_error_report = true;
    }

    switch (error_kind.$) {
      case "LineOverflow":
        return this.config.error_on_line_overflow() && allow_error_report;
      case "TrailingWhitespace":
      case "LostComment":
        return allow_error_report;
      default:
        return true;
    }
  }

  /// Returns `true` if the line with the given line number was skipped by `#[rustfmt::skip]`.
  // rustc: src/tools/rustfmt/src/formatting.rs:639 is_skipped_line
  is_skipped_line(): boolean {
    return this.skipped_range.some(([lo, hi]) => lo <= this.cur_line && this.cur_line <= hi);
  }
}

/** `s.chars()`: the code points of a JS string. */
function* string_chars(s: string): Generator<number, void, undefined> {
  for (const c of s) yield c.codePointAt(0)!;
}

// rustc: src/tools/rustfmt/src/formatting.rs:646 should_emit_verbose
function should_emit_verbose(forbid_verbose_output: boolean, config: Config, f: () => void): void {
  if (config.verbose() === "Verbose" && !forbid_verbose_output) {
    f();
  }
}
