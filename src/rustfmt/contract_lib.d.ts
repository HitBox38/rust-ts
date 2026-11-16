// Hand-written contract of lane rustfmt-contract-1 (not generated): what src/rustfmt/lib.ts uses from rustfmt modules that
// later lanes port (rustfmt-contract-2/-3 and the fill lanes of plan-m8 §3c), as ambient `declare module` blocks. TypeScript
// consults a block only while no file resolves the import, so lib.ts type-checks now and is checked against the real module
// once it lands. lib.ts imports these modules by the specifiers below (`../rustfmt/<path>`, which from src/rustfmt/ name the
// same files as `./<path>`); a block's name is that specifier plus `*` (as contract.gen.d.ts: TypeScript matches no ambient
// name that looks relative without it). The lane that creates a module deletes its block here, and may rewrite lib.ts's
// specifier to `./<path>`. Signatures follow upstream at the pin; the porting lane owns the final shape.

declare module "../rustfmt/comment.ts*" {
  // comment.rs: `pub(crate) enum FullCodeCharKind`
  export type FullCodeCharKind = string;
  // comment.rs:1556 `pub(crate) struct LineClasses<'a>`: `Iterator<Item = (FullCodeCharKind, String)>`
  export class LineClasses implements Iterable<[FullCodeCharKind, string]> {
    static new(s: string): LineClasses;
    [Symbol.iterator](): Iterator<[FullCodeCharKind, string]>;
  }
}

declare module "../rustfmt/emitter.ts*" {
  type IoResult<T> = import("../std/io.ts").IoResult<T>;
  type Write = import("./lib.ts").Write;
  // emitter.rs `pub(crate) trait Emitter` (the provided methods lib.rs calls)
  export interface Emitter {
    emit_header(output: Write): IoResult<null>;
    emit_footer(output: Write): IoResult<null>;
  }
  // emitter/*.rs, re-exported by emitter.rs (`pub(crate) use self::files::*;` ..): the constructors lib.rs:518 calls
  export function default_FilesWithBackupEmitter(): Emitter;
  export const FilesEmitter: { new_(print_misformatted_file_names: boolean): Emitter };
  export const StdoutEmitter: { new_(verbosity: import("./config/mod.ts").Verbosity): Emitter };
  export function default_JsonEmitter(): Emitter;
  export function default_ModifiedLinesEmitter(): Emitter;
  export function default_CheckstyleEmitter(): Emitter;
  export const DiffEmitter: { new_(config: import("./config/mod.ts").Config): Emitter };
}

declare module "../rustfmt/formatting.ts*" {
  type FileName = import("./config/mod.ts").FileName;
  // formatting.rs:27 `pub(crate) type SourceFile = Vec<FileRecord>;`
  export type FileRecord = unknown;
  export type SourceFile = FileRecord[];
  // formatting.rs:316
  export interface FormattingError {
    kind: import("./lib.ts").ErrorKind;
  }
  // formatting.rs:361 `pub(crate) type FormatErrorMap = HashMap<FileName, Vec<FormattingError>>;`
  export type FormatErrorMap = import("../rust_ts/keyed.ts").KeyedMap<FileName, FormattingError[]>;
  export function new_FormatErrorMap(): FormatErrorMap;
  // formatting.rs:364 `#[derive(Clone, Copy, Debug, Default)] pub(crate) struct ReportedErrors`
  export interface ReportedErrors {
    has_operational_errors: boolean;
    has_parsing_errors: boolean;
    has_formatting_errors: boolean;
    has_macro_format_failure: boolean;
    has_check_errors: boolean;
    has_diff: boolean;
    has_unformatted_code_errors: boolean;
  }
  export function default_ReportedErrors(): ReportedErrors;
}

declare module "../rustfmt/modules.ts*" {
  // modules.rs:70 `pub struct ModuleResolutionError`
  export interface ModuleResolutionError {}
  export const debug_ModuleResolutionError: import("../std/fmt.ts").Debug<ModuleResolutionError>;
  export function display_ModuleResolutionError(e: ModuleResolutionError): string;
}

declare module "../rustfmt/parse/parser.ts*" {
  // parse/parser.rs:15 `pub(crate) type DirectoryOwnership = rustc_expand::module::DirOwnership;`
  export type DirectoryOwnership = import("../rustc_expand/module.ts").DirOwnership;
}

declare module "../rustfmt/utils.ts*" {
  // utils.rs:732
  export function indent_next_line(kind: import("../rustfmt/comment.ts").FullCodeCharKind, line: string, config: import("./config/mod.ts").Config): boolean;
}

declare module "../rustfmt/format_report_formatter.ts*" {
  // format_report_formatter.rs: `FormatReportFormatterBuilder::new(&report).enable_colors(b).build()` and its `Display`
  export class FormatReportFormatter {}
  export function display_FormatReportFormatter(f: FormatReportFormatter): string;
  export class FormatReportFormatterBuilder {
    static new(report: import("./lib.ts").FormatReport): FormatReportFormatterBuilder;
    enable_colors(enable_colors: boolean): FormatReportFormatterBuilder;
    build(): FormatReportFormatter;
  }
}

declare module "../rustfmt/rustfmt_diff.ts*" {
  // rustfmt_diff.rs: re-exported by lib.rs:53
  export interface ModifiedChunk {}
  export interface ModifiedLines {}
}

declare module "../rustfmt/rewrite.ts*" {
  // rewrite.rs:65 `pub(crate) struct ExceedsMaxWidthError` (used by shape.ts)
  export interface ExceedsMaxWidthError {
    configured_width: number;
    span: import("../rustc_span/lib.ts").Span;
  }
}
