// Port of src/tools/rustfmt/src/lib.rs (lane rustfmt-contract-1).
// The modules lib.rs uses that later lanes port are imported as `../rustfmt/<path>` and declared in contract_lib.d.ts until
// they exist (see there). `mod x;` declarations become imports here as each module lands (PORTING §5 "Methods defined in
// another file"): `formatting.rs` adds `Session::format_input_inner` (declared on `Session` below).
import "./config/mod.ts";
import { type Config, clone_Config, type EmitMode, FileName, type NewlineStyle, type Verbosity } from "./config/mod.ts";
import { LineClasses } from "../rustfmt/comment.ts";
import {
  DiffEmitter,
  type Emitter,
  FilesEmitter,
  StdoutEmitter,
  default_CheckstyleEmitter,
  default_FilesWithBackupEmitter,
  default_JsonEmitter,
  default_ModifiedLinesEmitter,
} from "../rustfmt/emitter.ts";
import { type FormattingError, type ReportedErrors, type SourceFile, default_ReportedErrors, new_FormatErrorMap, type FormatErrorMap } from "../rustfmt/formatting.ts";
import { type ModuleResolutionError, debug_ModuleResolutionError, display_ModuleResolutionError } from "../rustfmt/modules.ts";
import type { DirectoryOwnership } from "../rustfmt/parse/parser.ts";
import { Indent } from "./shape.ts";
import { indent_next_line } from "../rustfmt/utils.ts";
import { FormatReportFormatterBuilder, display_FormatReportFormatter } from "../rustfmt/format_report_formatter.ts";
import { Ident } from "../rustc_span/symbol.ts";
import { type Debug, debug_int, debug_str, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { metadata } from "../std/fs.ts";
import { type IoError, type IoResult, debug_IoError, display_IoError } from "../std/io.ts";
import { path_file_stem, path_join, path_parent } from "../std/path.ts";
import { Panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8_len } from "../std/str.ts";

export {
  type CliOptions,
  Color,
  Config,
  Edition,
  EmitMode,
  FileLines,
  type FileName,
  NewlineStyle,
  Range,
  StyleEdition,
  Verbosity,
  Version,
  load_config,
} from "./config/mod.ts";

export { FormatReportFormatter, FormatReportFormatterBuilder } from "../rustfmt/format_report_formatter.ts";

export type { ModifiedChunk, ModifiedLines } from "../rustfmt/rustfmt_diff.ts";

// `macro_rules! static_regex` (lib.rs:58): `regex` may be a PORT `RegExp` per pattern where the semantics provably agree
// (plan-m8 D7); each user (string.rs, items.rs, ..) ports its pattern at the call.

/** `ignore::Error` (the `ignore` crate, plan-m8 D7: vendored for the `ignore` option; not ported yet). */
export type IgnoreError = { readonly __ignore_Error: never };

/// The various errors that can occur during formatting. Note that not all of
/// these can currently be propagated to clients.
// `#[derive(Error, Debug)]`
export type ErrorKind =
  /// Line has exceeded character limit (found, maximum).
  | { readonly $: "LineOverflow"; _0: number; _1: number }
  /// Line ends in whitespace.
  | { readonly $: "TrailingWhitespace" }
  /// Used deprecated skip attribute.
  | { readonly $: "DeprecatedAttr" }
  /// Used a rustfmt:: attribute other than skip or skip::macros.
  | { readonly $: "BadAttr" }
  /// An io error during reading or writing.
  | { readonly $: "IoError"; _0: IoError }
  /// Error during module resolution.
  | { readonly $: "ModuleResolutionError"; _0: ModuleResolutionError }
  /// Parse error occurred when parsing the input.
  | { readonly $: "ParseError" }
  /// The user mandated a version and the current version of Rustfmt does not
  /// satisfy that requirement.
  | { readonly $: "VersionMismatch" }
  /// If we had formatted the given node, then we would have lost a comment.
  | { readonly $: "LostComment" }
  /// Invalid glob pattern in `ignore` configuration option.
  | { readonly $: "InvalidGlobPattern"; _0: IgnoreError };
export const ErrorKind = {
  TrailingWhitespace: Object.freeze({ $: "TrailingWhitespace" as const }),
  DeprecatedAttr: Object.freeze({ $: "DeprecatedAttr" as const }),
  BadAttr: Object.freeze({ $: "BadAttr" as const }),
  ParseError: Object.freeze({ $: "ParseError" as const }),
  VersionMismatch: Object.freeze({ $: "VersionMismatch" as const }),
  LostComment: Object.freeze({ $: "LostComment" as const }),

  // rustc: src/tools/rustfmt/src/lib.rs:148 is_comment
  is_comment(self: ErrorKind): boolean {
    return self.$ === "LostComment";
  },

  // `impl From<io::Error> for ErrorKind`
  // rustc: src/tools/rustfmt/src/lib.rs:154 from
  from(e: IoError): ErrorKind {
    return { $: "IoError", _0: e };
  },

  /** `#[from] ModuleResolutionError` (thiserror's `From` impl). */
  from_ModuleResolutionError(e: ModuleResolutionError): ErrorKind {
    return { $: "ModuleResolutionError", _0: e };
  },
};
export const debug_ErrorKind: Debug<ErrorKind> = (v, f) => {
  switch (v.$) {
    case "LineOverflow":
      return debug_tuple(f, "LineOverflow", [debug_int(v._0, f), debug_int(v._1, f)]);
    case "IoError":
      return debug_tuple(f, "IoError", [debug_IoError(v._0, f)]);
    case "ModuleResolutionError":
      return debug_tuple(f, "ModuleResolutionError", [debug_ModuleResolutionError(v._0, f)]);
    case "InvalidGlobPattern":
      return debug_tuple(f, "InvalidGlobPattern", [unported("vendor-ignore: Debug for ignore::Error")]);
    default:
      return v.$;
  }
};
/** thiserror's `Display` (the `#[error(..)]` texts). */
export function display_ErrorKind(v: ErrorKind): string {
  switch (v.$) {
    case "LineOverflow":
      return `line formatted, but exceeded maximum width (maximum: ${v._1} (see \`max_width\` option), found: ${v._0})`;
    case "TrailingWhitespace":
      return "left behind trailing whitespace";
    case "DeprecatedAttr":
      return "`rustfmt_skip` is deprecated; use `rustfmt::skip`";
    case "BadAttr":
      return "invalid attribute";
    case "IoError":
      return `io error: ${display_IoError(v._0)}`;
    case "ModuleResolutionError":
      return display_ModuleResolutionError(v._0);
    case "ParseError":
      return "parse error";
    case "VersionMismatch":
      return "version mismatch";
    case "LostComment":
      return "not formatted because a comment would be lost";
    case "InvalidGlobPattern":
      return `Invalid glob pattern found in ignore list: ${unported("vendor-ignore: Display for ignore::Error")}`;
  }
}

/// Result of formatting a snippet of code along with ranges of lines that didn't get formatted,
/// i.e., that got returned as they were originally.
// `#[derive(Debug)]`
export class FormattedSnippet {
  constructor(
    public snippet: string,
    public non_formatted_ranges: [number, number][],
  ) {}

  /// In case the snippet needed to be wrapped in a function, this shifts down the ranges of
  /// non-formatted code.
  // rustc: src/tools/rustfmt/src/lib.rs:170 unwrap_code_block
  unwrap_code_block(): void {
    this.non_formatted_ranges.forEach((r) => {
      r[0] -= 1;
      r[1] -= 1;
    });
  }

  /// Returns `true` if the line n did not get formatted.
  // rustc: src/tools/rustfmt/src/lib.rs:180 is_line_non_formatted
  is_line_non_formatted(n: number): boolean {
    return this.non_formatted_ranges.some(([low, high]) => low <= n && n <= high);
  }
}
export const debug_FormattedSnippet: Debug<FormattedSnippet> = (v, f) =>
  debug_struct(f, "FormattedSnippet", [
    ["snippet", debug_str(v.snippet)],
    ["non_formatted_ranges", debug_vec(v.non_formatted_ranges, f, (r, f) => debug_tuple(f, "", [debug_int(r[0], f), debug_int(r[1], f)]))],
  ]);

/// Reports on any issues that occurred during a run of Rustfmt.
///
/// Can be reported to the user using the `Display` impl on [`FormatReportFormatter`].
// `#[derive(Clone)]`: `internal` is an `Rc<RefCell<..>>`, shared by the clones.
export class FormatReport {
  constructor(
    // Maps stringified file paths to their associated formatting errors.
    public internal: [FormatErrorMap, ReportedErrors],
    public non_formatted_ranges: [number, number][],
  ) {}

  // rustc: src/tools/rustfmt/src/lib.rs:198 new
  static new(): FormatReport {
    return new FormatReport([new_FormatErrorMap(), default_ReportedErrors()], []);
  }

  // rustc: src/tools/rustfmt/src/lib.rs:205 add_non_formatted_ranges
  add_non_formatted_ranges(ranges: [number, number][]): void {
    this.non_formatted_ranges.push(...ranges.splice(0));
  }

  // rustc: src/tools/rustfmt/src/lib.rs:209 append
  append(f: FileName, v: FormattingError[]): void {
    this.track_errors(v);
    const m = this.internal[0];
    const fe = m.get(f);
    if (fe !== undefined) {
      fe.push(...v.splice(0));
    } else {
      m.set(f, v);
    }
  }

  // rustc: src/tools/rustfmt/src/lib.rs:219 track_errors
  track_errors(new_errors: readonly FormattingError[]): void {
    const errs = this.internal[1];
    if (new_errors.length !== 0) {
      errs.has_formatting_errors = true;
    }
    if (errs.has_operational_errors && errs.has_check_errors && errs.has_unformatted_code_errors) {
      return;
    }
    for (const err of new_errors) {
      switch (err.kind.$) {
        case "LineOverflow":
          errs.has_operational_errors = true;
          break;
        case "TrailingWhitespace":
          errs.has_operational_errors = true;
          errs.has_unformatted_code_errors = true;
          break;
        case "LostComment":
          errs.has_unformatted_code_errors = true;
          break;
        case "DeprecatedAttr":
        case "BadAttr":
        case "VersionMismatch":
          errs.has_check_errors = true;
          break;
        default:
          break;
      }
    }
  }

  // rustc: src/tools/rustfmt/src/lib.rs:248 add_diff
  add_diff(): void {
    this.internal[1].has_diff = true;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:252 add_macro_format_failure
  add_macro_format_failure(): void {
    this.internal[1].has_macro_format_failure = true;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:256 add_parsing_error
  add_parsing_error(): void {
    this.internal[1].has_parsing_errors = true;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:260 warning_count
  warning_count(): number {
    let n = 0;
    for (const errors of this.internal[0].values()) n += errors.length;
    return n;
  }

  /// Whether any warnings or errors are present in the report.
  // rustc: src/tools/rustfmt/src/lib.rs:270 has_warnings
  has_warnings(): boolean {
    return this.internal[1].has_formatting_errors;
  }

  /// Print the report to a terminal using colours and potentially other
  /// fancy output.
  /// #[deprecated(note = "Use FormatReportFormatter with colors enabled instead")]
  // rustc: src/tools/rustfmt/src/lib.rs:277 fancy_print
  fancy_print(_t: unknown): Result<null, unknown> {
    // `writeln!(t, "{}", FormatReportFormatterBuilder::new(self).enable_colors(true).build())?` on a
    // `Box<dyn term::Terminal<Output = io::Stderr>>`
    return unported("term: Terminal (FormatReport::fancy_print; plan-m8 D7)");
  }
}

/** `#[derive(Clone)]` of `FormatReport`: the `Rc` is shared, the ranges copied. */
export function clone_FormatReport(v: FormatReport): FormatReport {
  return new FormatReport(v.internal, v.non_formatted_ranges.map(([a, b]) => [a, b]));
}

/// Deprecated - Use FormatReportFormatter instead
// https://github.com/rust-lang/rust/issues/78625
// https://github.com/rust-lang/rust/issues/39935
// Prints all the formatting errors.
// rustc: src/tools/rustfmt/src/lib.rs:297 fmt
export function display_FormatReport(self: FormatReport): string {
  return display_FormatReportFormatter(FormatReportFormatterBuilder.new(self).build());
}

/** `std::panic::catch_unwind`: a `Panic` (the hook already ran at the panic: std/panic.ts) becomes `Err`; anything else
 *  (`Unported`, a JS error) keeps unwinding. */
function catch_unwind<T>(f: () => T): Result<T, Panic> {
  try {
    return Ok(f());
  } catch (e) {
    if (e instanceof Panic) return Err(e);
    throw e;
  }
}

/** `std::io::Write`, as rustfmt's sessions and emitters use it (`write!`/`writeln!` → `write_fmt`, `write_all`).
 *  PORT: src/std has no `Write` trait yet; this is the subset the rustfmt port needs (handoff: a candidate for src/std). */
export interface Write {
  write_fmt(text: string): IoResult<null>;
  write_all(buf: Uint8Array): IoResult<null>;
}

/** `Vec<u8>` as an `io::Write` (std: `impl Write for Vec<u8>`: appends, never fails). */
export class VecU8 implements Write {
  chunks: Uint8Array[] = [];
  write_fmt(text: string): IoResult<null> {
    return this.write_all(new TextEncoder().encode(text));
  }
  write_all(buf: Uint8Array): IoResult<null> {
    this.chunks.push(buf.slice());
    return Ok(null);
  }
  is_empty(): boolean {
    return this.chunks.every((c) => c.length === 0);
  }
  /** `String::from_utf8(vec)` */
  into_string(): string | undefined {
    const all = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(all);
    } catch {
      return undefined;
    }
  }
}

/// Format the given snippet. The snippet is expected to be *complete* code.
/// When we cannot parse the given snippet, this function returns `None`.
// rustc: src/tools/rustfmt/src/lib.rs:305 format_snippet
export function format_snippet(snippet: string, config_: Config, is_macro_def: boolean): FormattedSnippet | undefined {
  const config = clone_Config(config_);
  const r = catch_unwind((): FormattedSnippet | undefined => {
    const out = new VecU8();
    config.set().emit_mode("Stdout");
    config.set().verbose("Quiet");
    config.set().show_parse_errors(false);
    if (is_macro_def) {
      config.set().error_on_unformatted(true);
    }

    let formatting_error: boolean;
    let result: Result<FormatReport, ErrorKind>;
    {
      const input: Input = { $: "Text", _0: snippet };
      const session = Session.new(config, out);
      try {
        result = session.format_input_inner(input, is_macro_def);
        formatting_error =
          session.errors.has_macro_format_failure ||
          (session.out!.is_empty() && snippet !== "") ||
          result.$ === "Err" ||
          (is_macro_def && session.has_unformatted_code_errors());
      } finally {
        // PORT: the block's end drops `session` (`impl Drop for Session`: the emitter's footer).
        session.drop();
      }
    }
    if (formatting_error) {
      return undefined;
    } else {
      const s = out.into_string();
      return s === undefined ? undefined : new FormattedSnippet(s, (result as { _0: FormatReport })._0.non_formatted_ranges);
    }
  });
  // Discard panics encountered while formatting the snippet
  // The ? operator is needed to remove the extra Option
  return r.$ === "Ok" ? r._0 : undefined;
}

/// Format the given code block. Mainly targeted for code block in comment.
/// The code block may be incomplete (i.e., parser may be unable to parse it).
/// To avoid panic in parser, we wrap the code block with a dummy function.
/// The returned code block does **not** end with newline.
// rustc: src/tools/rustfmt/src/lib.rs:346 format_code_block
export function format_code_block(code_snippet: string, config: Config, is_macro_def: boolean): FormattedSnippet | undefined {
  const FN_MAIN_PREFIX = "fn main() {\n";

  // rustc: src/tools/rustfmt/src/lib.rs:353 enclose_in_main_block
  function enclose_in_main_block(s: string, config: Config): string {
    const indent = Indent.from_width(config, config.tab_spaces());
    let result = "";
    result += FN_MAIN_PREFIX;
    let need_indent = true;
    for (const [kind, line] of LineClasses.new(s)) {
      if (need_indent) {
        result += indent.to_string(config);
      }
      result += line;
      result += "\n";
      need_indent = indent_next_line(kind, line, config);
    }
    result += "}";
    return result;
  }

  // Wrap the given code block with `fn main()` if it does not have one.
  const snippet = enclose_in_main_block(code_snippet, config);
  let result = "";
  let is_first = true;

  // While formatting the code, ignore the config's newline style setting and always use "\n"
  // instead of "\r\n" for the newline characters. This is ok because the output here is
  // not directly outputted by rustfmt command, but used by the comment formatter's input.
  // We have output-file-wide "\n" ==> "\r\n" conversion process after here if it's necessary.
  const config_with_unix_newline = clone_Config(config);
  config_with_unix_newline.set().newline_style("Unix" satisfies NewlineStyle);
  const formatted = format_snippet(snippet, config_with_unix_newline, is_macro_def);
  if (formatted === undefined) return undefined;
  // Remove wrapping main block
  formatted.unwrap_code_block();

  // Trim "fn main() {" on the first line and "}" on the last line,
  // then unindent the whole code block.
  // PORT: `rfind('}')` and `FN_MAIN_PREFIX.len()` index the same string in one unit (UTF-16 here, bytes upstream); both
  // land on ASCII characters, so the slice below is the same text.
  const rfind = formatted.snippet.lastIndexOf("}");
  const block_len = rfind < 0 ? formatted.snippet.length : rfind;

  // It's possible that `block_len < FN_MAIN_PREFIX.len()`. This can happen if the code block was
  // formatted into the empty string, leading to the enclosing `fn main() {\n}` being formatted
  // into `fn main() {}`. In this case no unindentation is done.
  const block_start = Math.min(FN_MAIN_PREFIX.length, block_len);

  let is_indented = true;
  const indent_str = Indent.from_width(config, config.tab_spaces()).to_string(config);
  for (const [kind, line] of LineClasses.new(formatted.snippet.slice(block_start, block_len))) {
    if (!is_first) {
      result += "\n";
    } else {
      is_first = false;
    }
    let trimmed_line: string;
    if (!is_indented) {
      trimmed_line = line;
    } else if (utf8_len(line) > config.max_width()) {
      // If there are lines that are larger than max width, we cannot tell
      // whether we have succeeded but have some comments or strings that
      // are too long, or we have failed to format code block. We will be
      // conservative and just return `None` in this case.
      return undefined;
    } else if (utf8_len(line) > utf8_len(indent_str)) {
      // Make sure that the line has leading whitespaces.
      if (line.startsWith(indent_str)) {
        const offset = config.hard_tabs() ? 1 : config.tab_spaces();
        // PORT: `offset` bytes of the ASCII indentation `line` starts with: the same count of UTF-16 units.
        trimmed_line = line.slice(offset);
      } else {
        trimmed_line = line;
      }
    } else {
      trimmed_line = line;
    }
    result += trimmed_line;
    is_indented = indent_next_line(kind, line, config);
  }
  return new FormattedSnippet(result, formatted.non_formatted_ranges);
}

/// A session is a run of rustfmt across a single or multiple inputs.
export class Session<T extends Write = Write> {
  constructor(
    public config: Config,
    public out: T | undefined,
    public errors: ReportedErrors,
    public source_file: SourceFile,
    public emitter: Emitter,
  ) {}

  // rustc: src/tools/rustfmt/src/lib.rs:449 new
  static new<T extends Write>(config: Config, out: T | undefined): Session<T> {
    const emitter = create_emitter(config);

    if (out !== undefined) {
      emitter.emit_header(out);
    }

    return new Session(config, out, default_ReportedErrors(), [], emitter);
  }

  /// The main entry point for Rustfmt. Formats the given input according to the
  /// session's config.
  // rustc: src/tools/rustfmt/src/lib.rs:467 format
  format(input: Input): Result<FormatReport, ErrorKind> {
    return this.format_input_inner(input, false);
  }

  // rustc: src/tools/rustfmt/src/lib.rs:471 override_config
  override_config<U>(config: Config, f: (session: Session<T>) => U): U {
    // `mem::swap(&mut config, &mut self.config)` before and after `f(self)`
    const saved = this.config;
    this.config = config;
    const result = f(this);
    this.config = saved;
    return result;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:481 add_operational_error
  add_operational_error(): void {
    this.errors.has_operational_errors = true;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:485 has_operational_errors
  has_operational_errors(): boolean {
    return this.errors.has_operational_errors;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:489 has_parsing_errors
  has_parsing_errors(): boolean {
    return this.errors.has_parsing_errors;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:493 has_formatting_errors
  has_formatting_errors(): boolean {
    return this.errors.has_formatting_errors;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:497 has_check_errors
  has_check_errors(): boolean {
    return this.errors.has_check_errors;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:501 has_diff
  has_diff(): boolean {
    return this.errors.has_diff;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:505 has_unformatted_code_errors
  has_unformatted_code_errors(): boolean {
    return this.errors.has_unformatted_code_errors;
  }

  // rustc: src/tools/rustfmt/src/lib.rs:509 has_no_errors
  has_no_errors(): boolean {
    return !(
      this.has_operational_errors() ||
      this.has_parsing_errors() ||
      this.has_formatting_errors() ||
      this.has_check_errors() ||
      this.has_diff() ||
      this.has_unformatted_code_errors() ||
      this.errors.has_macro_format_failure
    );
  }

  // `impl Drop for Session`. PORT: called explicitly where the Rust value goes out of scope.
  // rustc: src/tools/rustfmt/src/lib.rs:539 drop
  drop(): void {
    if (this.out !== undefined) {
      this.emitter.emit_footer(this.out);
    }
  }
}

// formatting.rs (lane rustfmt-contract-2) adds this method (`impl<'b, T: Write + 'b> Session<'b, T>`, formatting.rs:31):
export interface Session<T extends Write = Write> {
  format_input_inner(input: Input, is_macro_def: boolean): Result<FormatReport, ErrorKind>;
}

// rustc: src/tools/rustfmt/src/lib.rs:520 create_emitter
export function create_emitter(config: Config): Emitter {
  const emit_mode: EmitMode = config.emit_mode();
  switch (emit_mode) {
    case "Files":
      if (config.make_backup()) {
        return default_FilesWithBackupEmitter();
      }
      return FilesEmitter.new_(config.print_misformatted_file_names());
    case "Stdout":
    case "Coverage":
      return StdoutEmitter.new_(config.verbose() satisfies Verbosity);
    case "Json":
      return default_JsonEmitter();
    case "ModifiedLines":
      return default_ModifiedLinesEmitter();
    case "Checkstyle":
      return default_CheckstyleEmitter();
    case "Diff":
      return DiffEmitter.new_(clone_Config(config));
  }
}

// `#[derive(Debug)]`
export type Input =
  | { readonly $: "File"; _0: string }
  | { readonly $: "Text"; _0: string };
export const debug_Input: Debug<Input> = (v, f) => debug_tuple(f, v.$, [debug_str(v._0)]);
export const Input = {
  // rustc: src/tools/rustfmt/src/lib.rs:553 file_name
  file_name(self: Input): FileName {
    switch (self.$) {
      case "File":
        return { $: "Real", _0: self._0 };
      case "Text":
        return FileName.Stdin;
    }
  },

  // rustc: src/tools/rustfmt/src/lib.rs:560 to_directory_ownership
  to_directory_ownership(self: Input): DirectoryOwnership | undefined {
    switch (self.$) {
      case "File": {
        const file = self._0;
        // If there exists a directory with the same name as an input,
        // then the input should be parsed as a sub module.
        const file_stem = path_file_stem(file);
        if (file_stem === undefined) return undefined;
        const parent = path_parent(file);
        if (parent === undefined) return undefined;
        const m = metadata(path_join(parent, file_stem));
        if (m.$ === "Ok" && m._0.is_dir()) {
          // PORT: `file_stem.to_str()` is `None` only for a non-UTF-8 stem, which a JS string cannot hold.
          return { $: "Owned", relative: Ident.from_str(file_stem) };
        } else {
          return undefined;
        }
      }
      default:
        return undefined;
    }
  },
};
