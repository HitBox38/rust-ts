// Hand-written contract of lanes rustfmt-contract-1/-2 (not generated): what src/rustfmt/lib.ts, rewrite.ts, utils.ts,
// spanned.ts and source_map.ts use from rustfmt modules that later lanes port (rustfmt-contract-3 and the fill lanes of
// plan-m8 §3c) and from the vendor crates of vendor-fmt-small (plan-m8 D7), as ambient `declare module` blocks. TypeScript
// consults a block only while no file resolves the import, so the importers type-check now and are checked against the real module
// once it lands. They import these modules by the specifiers below (`../rustfmt/<path>`, which from src/rustfmt/ name the
// same files as `./<path>`); a block's name is that specifier plus `*` (as contract.gen.d.ts: TypeScript matches no ambient
// name that looks relative without it). The lane that creates a module deletes its block here, and may rewrite lib.ts's
// specifier to `./<path>`. Signatures follow upstream at the pin; the porting lane owns the final shape.

declare module "../rustfmt/comment.ts*" {
  // comment.rs:1275 `pub(crate) enum FullCodeCharKind` (fieldless: a string union and its companion, PORTING §5)
  export type FullCodeCharKind =
    | "Normal"
    | "StartComment"
    | "InComment"
    | "EndComment"
    | "StartStringCommented"
    | "EndStringCommented"
    | "InStringCommented"
    | "StartString"
    | "EndString"
    | "InString";
  export const FullCodeCharKind: {
    // comment.rs `impl FullCodeCharKind` (the methods utils.rs calls)
    is_string(self: FullCodeCharKind): boolean;
    is_commented_string(self: FullCodeCharKind): boolean;
  };
  // comment.rs:1556 `pub(crate) struct LineClasses<'a>`: `Iterator<Item = (FullCodeCharKind, String)>`
  export class LineClasses implements Iterable<[FullCodeCharKind, string]> {
    static new(s: string): LineClasses;
    [Symbol.iterator](): Iterator<[FullCodeCharKind, string]>;
  }
  // comment.rs:1211 `pub(crate) struct CharClasses<T>` over `s.chars()` (utils.rs:606): `Iterator<Item = (FullCodeCharKind,
  // char)>`, chars as Unicode scalar values (PORTING §5). Upstream is generic over `T: Iterator, T::Item: RichChar`; the
  // comment lane picks the final shape and adjusts utils.ts's call.
  export class CharClasses implements Iterable<[FullCodeCharKind, number]> {
    static new(base: Iterator<number>): CharClasses;
    [Symbol.iterator](): Iterator<[FullCodeCharKind, number]>;
  }
  // comment.rs:1779
  export function filter_normal_code(code: string): string;
  // comment.rs:1143 `pub(crate) trait FindUncommented` and its `impl FindUncommented for str` (:1148): returns a UTF-8
  // byte offset, as upstream (source_map.ts slices and adds it to a `BytePos`).
  export const FindUncommented_str: {
    find_uncommented(self: string, pat: string): number | undefined;
  };
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

declare module "../rustfmt/parse/session.ts*" {
  type Span = import("../rustc_span/lib.ts").Span;
  // parse/session.rs `pub(crate) struct ParseSess`: what rewrite.rs and utils.rs's `out_of_file_lines_range!` use.
  export class ParseSess {
    // parse/session.rs:284 `impl LineRangeUtils for ParseSess` (the trait is source_map.rs's)
    lookup_line_range(span: Span): import("./config/file_lines.ts").LineRange;
  }
}

declare module "../rustfmt/skip.ts*" {
  // skip.rs `pub(crate) struct SkipContext` (rustfmt-contract-3): a field of `RewriteContext`
  export class SkipContext {}
}

declare module "../rustfmt/visitor.ts*" {
  type Span = import("../rustc_span/lib.ts").Span;
  type BytePos = import("../rustc_span/lib.ts").BytePos;
  // visitor.rs:35 `pub(crate) struct SnippetProvider`
  export class SnippetProvider {
    // visitor.rs:45; text is a JS `string` (utils.ts)
    span_to_snippet(span: Span): string | undefined;
    // source_map.rs:28 `impl SpanUtils for SnippetProvider` (source_map.ts also augments the real module with these)
    span_after(original: Span, needle: string): BytePos;
    span_after_last(original: Span, needle: string): BytePos;
    span_before(original: Span, needle: string): BytePos;
    span_before_last(original: Span, needle: string): BytePos;
    opt_span_after(original: Span, needle: string): BytePos | undefined;
    opt_span_before(original: Span, needle: string): BytePos | undefined;
  }
}

declare module "../rustfmt/macros.ts*" {
  // macros.rs:59 `pub(crate) enum MacroArg` (`Box<T>` is `T`)
  export type MacroArg =
    | { readonly $: "Expr"; _0: import("../rustc_ast/lib.ts").ast.Expr }
    | { readonly $: "Ty"; _0: import("../rustc_ast/lib.ts").ast.Ty }
    | { readonly $: "Pat"; _0: import("../rustc_ast/lib.ts").ast.Pat }
    | { readonly $: "Item"; _0: import("../rustc_ast/lib.ts").ast.Item }
    | { readonly $: "Keyword"; _0: import("../rustc_span/symbol.ts").Ident; _1: import("../rustc_span/lib.ts").Span };
}

declare module "../rustfmt/items.ts*" {
  type Param = import("../rustc_ast/lib.ts").ast.Param;
  // items.rs:2451, :2471 (spanned.rs's `impl Spanned for ast::Param`)
  export function span_lo_for_param(param: Param): import("../rustc_span/lib.ts").BytePos;
  export function is_named_param(param: Param): boolean;
}

declare module "../vendor/unicode_width_0_1/lib.ts*" {
  // unicode-width 0.1.14 (vendor-fmt-small, plan-m8 D7), `impl UnicodeWidthStr for str`, as src/vendor/unicode_width (0.2.2)
  export const UnicodeWidthStr: {
    width(self: string): number;
  };
}

declare module "../vendor/bytecount/lib.ts*" {
  // bytecount 0.6.9 (vendor-fmt-small, plan-m8 D7): `pub fn count(haystack: &[u8], needle: u8) -> usize`
  export function count(haystack: Uint8Array, needle: number): number;
}
