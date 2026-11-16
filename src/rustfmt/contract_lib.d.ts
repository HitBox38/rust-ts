// Hand-written contract of lane rustfmt-contract-1, extended by rustfmt-contract-3 (not generated): what src/rustfmt/lib.ts,
// shape.ts and formatting.ts use from rustfmt modules that
// later lanes port (rustfmt-contract-2/-3 and the fill lanes of plan-m8 §3c), as ambient `declare module` blocks. TypeScript
// consults a block only while no file resolves the import, so lib.ts type-checks now and is checked against the real module
// once it lands. lib.ts imports these modules by the specifiers below (`../rustfmt/<path>`, which from src/rustfmt/ name the
// same files as `./<path>`); a block's name is that specifier plus `*` (as contract.gen.d.ts: TypeScript matches no ambient
// name that looks relative without it). The lane that creates a module deletes its block here, and may rewrite lib.ts's
// specifier to `./<path>`. Signatures follow upstream at the pin; the porting lane owns the final shape.

declare module "../rustfmt/comment.ts*" {
  // comment.rs:1275 `pub(crate) enum FullCodeCharKind` (fieldless: a string union with a companion const, PORTING §5)
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
  // comment.rs:1298 `impl FullCodeCharKind` (the methods formatting.rs calls; rustfmt-contract-3)
  export const FullCodeCharKind: {
    is_comment(self: FullCodeCharKind): boolean;
    is_string(self: FullCodeCharKind): boolean;
  };
  // comment.rs:1211 `pub(crate) struct CharClasses<T>`: `Iterator<Item = (FullCodeCharKind, T::Item)>`. formatting.rs:523
  // feeds it `text.chars()` (chars are code points, PORTING §5). rustfmt-contract-3.
  export class CharClasses<T> implements Iterable<[FullCodeCharKind, T]> {
    static new<T>(base: Iterable<T>): CharClasses<T>;
    [Symbol.iterator](): Iterator<[FullCodeCharKind, T]>;
  }
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
  // emitter.rs:27 `pub(crate) struct EmitterResult` (the field formatting.rs:301 reads; rustfmt-contract-3)
  export interface EmitterResult {
    has_diff: boolean;
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

declare module "../rustfmt/modules.ts*" {
  // modules.rs:70 `pub struct ModuleResolutionError`
  export interface ModuleResolutionError {}
  export const debug_ModuleResolutionError: import("../std/fmt.ts").Debug<ModuleResolutionError>;
  export function display_ModuleResolutionError(e: ModuleResolutionError): string;
  // modules.rs:27 `pub(crate) struct Module<'a>` (what formatting.rs uses; rustfmt-contract-3)
  export class Module {
    span: import("../rustc_span/lib.ts").Span;
    attrs(): readonly import("../rustc_ast/lib.ts").Attribute[];
  }
  // modules.rs:23 `type FileModMap<'ast> = BTreeMap<FileName, Module<'ast>>;`: iterated in `FileName` order (formatting.rs:143)
  export type FileModMap = Iterable<[import("./config/mod.ts").FileName, Module]>;
  // modules.rs:60 `pub(crate) struct ModResolver<'ast, 'psess>` (rustfmt-contract-3)
  export class ModResolver {
    static new(
      psess: import("../rustfmt/parse/session.ts").ParseSess,
      directory_ownership: import("../rustfmt/parse/parser.ts").DirectoryOwnership,
      recursive: boolean,
    ): ModResolver;
    visit_crate(krate: import("../rustc_ast/lib.ts").Crate): import("../std/result.ts").Result<FileModMap, ModuleResolutionError>;
  }
}

declare module "../rustfmt/parse/parser.ts*" {
  // parse/parser.rs:15 `pub(crate) type DirectoryOwnership = rustc_expand::module::DirOwnership;` (type and companion:
  // formatting.rs:139 names `DirectoryOwnership::UnownedViaBlock`)
  export type DirectoryOwnership = import("../rustc_expand/module.ts").DirOwnership;
  export const DirectoryOwnership: typeof import("../rustc_expand/module.ts").DirOwnership;
  // parse/parser.rs:82 `pub(crate) enum ParserError` (fieldless; rustfmt-contract-3)
  export type ParserError = "NoParseSess" | "NoInput" | "ParserCreationError" | "ParseError" | "ParsePanicError";
  // parse/parser.rs:26 `pub(crate) struct Parser<'a>`: the associated fn formatting.rs:123 calls (rustfmt-contract-3)
  export class Parser {
    static parse_crate(
      input: import("./lib.ts").Input,
      psess: import("../rustfmt/parse/session.ts").ParseSess,
    ): import("../std/result.ts").Result<import("../rustc_ast/lib.ts").Crate, ParserError>;
  }
}

declare module "../rustfmt/parse/session.ts*" {
  // parse/session.rs:26 `pub(crate) struct ParseSess`: what formatting.rs calls (rustfmt-contract-3)
  export class ParseSess {
    static new(config: import("./config/mod.ts").Config): import("../std/result.ts").Result<ParseSess, import("./lib.ts").ErrorKind>;
    ignore_file(path: import("./config/mod.ts").FileName): boolean;
    set_silent_emitter(): void;
    span_to_file_contents(span: import("../rustc_span/lib.ts").Span): import("../rustc_span/lib.ts").SourceFile;
    span_to_first_line_string(span: import("../rustc_span/lib.ts").Span): string;
    line_of_byte_pos(pos: import("../rustc_span/lib.ts").BytePos): number;
    snippet_provider(span: import("../rustc_span/lib.ts").Span): import("../rustfmt/visitor.ts").SnippetProvider;
  }
}

declare module "../rustfmt/visitor.ts*" {
  type BytePos = import("../rustc_span/lib.ts").BytePos;
  // visitor.rs:35 `pub(crate) struct SnippetProvider` (rustfmt-contract-3)
  export class SnippetProvider {
    entire_snippet(): string;
    start_pos(): BytePos;
    end_pos(): BytePos;
  }
  // visitor.rs:74 `pub(crate) struct FmtVisitor<'a>`: the fields and methods formatting.rs uses (rustfmt-contract-3)
  export class FmtVisitor {
    buffer: string;
    last_pos: BytePos;
    line_number: number;
    /// List of 1-based line ranges which were annotated with skip
    /// Both bounds are inclusive.
    // `Rc<RefCell<Vec<(usize, usize)>>>`: the array, shared
    skipped_range: [number, number][];
    macro_rewrite_failure: boolean;
    skip_context: import("../rustfmt/skip.ts").SkipContext;
    is_macro_def: boolean;
    static from_psess(
      psess: import("../rustfmt/parse/session.ts").ParseSess,
      config: import("./config/mod.ts").Config,
      snippet_provider: SnippetProvider,
      report: import("./lib.ts").FormatReport,
    ): FmtVisitor;
    skip_empty_lines(end_pos: BytePos): void;
    format_separate_mod(m: import("../rustfmt/modules.ts").Module, end_pos: BytePos): void;
    // `impl Drop for FmtVisitor` (visitor.rs:95), called where the value leaves scope (as lib.ts's `Session::drop`)
    drop(): void;
  }
}

declare module "../rustfmt/source_file.ts*" {
  // source_file.rs:19 / :50 (rustfmt-contract-3)
  export function append_newline(s: import("../std/mut_ref.ts").MutRef<string>): void;
  export function write_file<T extends import("./lib.ts").Write>(
    psess: import("../rustfmt/parse/session.ts").ParseSess | undefined,
    filename: import("./config/mod.ts").FileName,
    formatted_text: string,
    out: T,
    emitter: import("../rustfmt/emitter.ts").Emitter,
    newline_style: import("./config/mod.ts").NewlineStyle,
  ): import("../std/io.ts").IoResult<import("../rustfmt/emitter.ts").EmitterResult>;
}

declare module "../rustfmt/utils.ts*" {
  // utils.rs:327 / :404 (used by formatting.rs; rustfmt-contract-3)
  export function contains_skip(attrs: readonly import("../rustc_ast/lib.ts").Attribute[]): boolean;
  export function count_newlines(input: string): number;
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
