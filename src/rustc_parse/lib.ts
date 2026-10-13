// Port of compiler/rustc_parse/src/lib.rs (crate root).
//! The main parser interface.
//
// PORT: extension modules (PORTING §5) are imported here for their side effects, after their
// defining module: `lexer/tokentrees.ts` adds methods to `Lexer` (after `lexer/mod.ts`); every parser
// file with an `impl Parser` block assigns onto `Parser.prototype` (after `parser/mod.ts`). See
// parser/mod.ts and parser/decls.ts for the init-order rules. Consumers import this module.
import "../rustc_ast/lib.ts";
import "./lexer/mod.ts";
import "./lexer/tokentrees.ts";
import "./parser/mod.ts";
import "./parser/attr.ts";
import "./parser/attr_wrapper.ts";
import "./parser/nonterminal.ts";
import "./parser/diagnostics.ts";
import "./parser/expr.ts";
import "./parser/expr/diagnostics.ts";
import "./parser/pat.ts";
import "./parser/path.ts";
import "./parser/ty.ts";
import "./parser/generics.ts";
import "./parser/stmt.ts";
import "./parser/item.ts";
import "./parser/function.ts";
import "./parser/asm.ts";
import "./parser/cfg_select.ts";

import { readdirSync, readFileSync } from "node:fs";

import { ast, token, tokenstream } from "../rustc_ast/lib.ts";
import type { TokenStream, TokenTree } from "../rustc_ast/tokenstream.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import { type Diag, FatalError, type PResult, pluralize } from "../rustc_errors/lib.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { FileName, type SourceFile, Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { display_IoError, type IoError } from "../std/io.ts";
import { assert_eq, panic, unported } from "../std/panic.ts";
import { path_join } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str } from "../std/str.ts";
import { lex_token_trees, StripTokens } from "./lexer/mod.ts";
import { Parser } from "./parser/mod.ts";

// pub use rustc_lexer::UNICODE_VERSION;
export { UNICODE_VERSION } from "../rustc_lexer/lib.ts";

export const MACRO_ARGUMENTS: string | undefined = "macro arguments";

// #[macro_use] pub mod parser;
export * as parser from "./parser/mod.ts";
// pub mod lexer;
export * as lexer from "./lexer/mod.ts";
// mod diagnostics; (crate-private; imported directly by the parser modules)

// Make sure that the Unicode version of the dependencies is the same.
// PORT: `const _: () = { .. }` is a compile-time check of rustc_lexer / rustc_span /
// unicode-normalization / unicode-width UNICODE_VERSION; the TS tables are generated per crate
// (tools/gen-unicode*.ts) and checked by their own tests, so there is no runtime counterpart.

// Unwrap the result if `Ok`, otherwise emit the diagnostics and abort.
// rustc: compiler/rustc_parse/src/lib.rs:78 unwrap_or_emit_fatal
export function unwrap_or_emit_fatal<T>(expr: Result<T, Diag[]>): T {
  switch (expr.$) {
    case "Ok":
      return expr._0;
    case "Err": {
      const errs = expr._0;
      for (const err of errs) {
        err.emit();
      }
      return new FatalError().raise();
    }
  }
}

/// Creates a new parser from a source string.
///
/// On failure, the errors must be consumed via `unwrap_or_emit_fatal`, `emit`, `cancel`,
/// etc., otherwise a panic will occur when they are dropped.
// rustc: compiler/rustc_parse/src/lib.rs:94 new_parser_from_source_str
export function new_parser_from_source_str(
  psess: ParseSess,
  name: FileName,
  source: string,
  strip_tokens: StripTokens,
): Result<Parser, Diag[]> {
  const source_file = psess.source_map().new_source_file(name, Str.from(source));
  return new_parser_from_source_file(psess, source_file, strip_tokens);
}

/// PORT: `std::io::Error::kind()` as used by `new_parser_from_file`. OS errors need
/// `decode_error_kind` (std, unported); the other reprs carry their kind.
function io_error_kind(e: IoError): string {
  switch (e.$) {
    case "Os":
      return unported(`std::io::Error::kind (decode_error_kind, os error ${e.code})`);
    case "Custom":
    case "SimpleMessage":
      return e.kind;
  }
}

/// PORT: `Path::display()`; paths are UTF-8 strings in rust-ts (`PathBuf` = `string`).
const display_path = (p: string): string => p;

/// Creates a new parser from a filename. On failure, the errors must be consumed via
/// `unwrap_or_emit_fatal`, `emit`, `cancel`, etc., otherwise a panic will occur when they are
/// dropped.
///
/// If a span is given, that is used on an error as the source of the problem.
///
/// Error messages are tailored to the specific error kind.
// rustc: compiler/rustc_parse/src/lib.rs:111 new_parser_from_file
export function new_parser_from_file(
  psess: ParseSess,
  path: string,
  strip_tokens: StripTokens,
  sp: Span | undefined,
): Result<Parser, Diag[]> {
  const sm = psess.source_map();
  const loaded = sm.load_file(path);
  let source_file: SourceFile;
  if (loaded.$ === "Ok") {
    source_file = loaded._0;
  } else {
    const e = loaded._0;
    // use std::io::ErrorKind;

    let msg: string;
    switch (io_error_kind(e)) {
      case "NotFound":
        msg = `couldn't find file \`${display_path(path)}\``;
        break;
      case "PermissionDenied":
        msg = `permission denied when opening file \`${display_path(path)}\``;
        break;
      case "IsADirectory":
        msg = `\`${display_path(path)}\` is a directory`;
        break;
      default:
        msg = `couldn't read \`${display_path(path)}\`: ${display_IoError(e)}`;
        break;
    }

    const err = psess.dcx().struct_fatal(msg);

    if (io_error_kind(e) === "NotFound") {
      // PORT: `Path::file_name`, `Path::parent`, `std::fs::read_dir` via node:path / node:fs.
      const file_name = path_file_name(path);
      if (file_name !== undefined) {
        const p = path_parent(path);
        const parent = p !== undefined && p !== "" ? p : ".";
        let entries: string[] | undefined;
        try {
          entries = readdirSync(parent);
        } catch {
          entries = undefined;
        }
        if (entries !== undefined) {
          const candidates: Symbol[] = entries.map((n) => Symbol.intern(n));
          const lookup = Symbol.intern(file_name);
          const suggestion = find_best_match_for_name(candidates, lookup, undefined);
          if (suggestion !== undefined) {
            const suggested_path =
              parent === "." ? Symbol.as_str(suggestion) : display_path(path_join(parent, Symbol.as_str(suggestion)));
            err.help(`you might have meant to open \`${suggested_path}\``);
          }
        }
      }
    }
    let contents: Uint8Array | undefined;
    try {
      contents = readFileSync(path);
    } catch {
      contents = undefined;
    }
    if (contents !== undefined) {
      const utf8err = from_utf8_error(contents);
      if (utf8err !== undefined) {
        utf8_error(sm, display_path(path), sp, err, utf8err, contents);
      }
    }
    if (sp !== undefined) {
      err.span(sp);
    }
    return err.emit_fatal();
  }
  return new_parser_from_source_file(psess, source_file, strip_tokens);
}

/// PORT: `core::str::Utf8Error` (`valid_up_to`, `error_len`).
export interface Utf8Error {
  valid_up_to(): number;
  error_len(): number | undefined;
}

/// PORT: `std::str::from_utf8(bytes).err()` (core::str::validations::run_utf8_validation).
function from_utf8_error(_bytes: Uint8Array): Utf8Error | undefined {
  return unported("core::str::from_utf8 (Utf8Error)");
}

/// PORT: `Path::file_name` / `Path::parent` for UTF-8 path strings ("/" separators).
function path_file_name(p: string): string | undefined {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  const n = i < 0 ? t : t.slice(i + 1);
  return n === "" || n === ".." ? undefined : n;
}
function path_parent(p: string): string | undefined {
  const t = p.replace(/\/+$/, "");
  if (t === "") return undefined;
  const i = t.lastIndexOf("/");
  return i < 0 ? "" : t.slice(0, i);
}

// rustc: compiler/rustc_parse/src/lib.rs:168 utf8_error
export function utf8_error(
  sm: SourceMap,
  path: string,
  sp: Span | undefined,
  err: Diag,
  utf8err: Utf8Error,
  contents: Uint8Array,
): void {
  // The file exists, but it wasn't valid UTF-8.
  const start = utf8err.valid_up_to();
  const note = `invalid utf-8 at byte \`${start}\``;
  let msg: string;
  const len = utf8err.error_len();
  if (len !== undefined) {
    const bytes = len === 1 ? `${contents[start]}` : `[${[...contents.slice(start, start + len)].join(", ")}]`;
    msg = `byte${pluralize(len)} \`${bytes}\` ${len === 1 ? "is" : "are"} not valid utf-8`;
  } else {
    msg = note;
  }
  // PORT: `String::from_utf8_lossy` = WHATWG UTF-8 decode (same maximal-subpart replacement).
  const contents_ = new TextDecoder("utf-8", { fatal: false }).decode(contents);

  // We only emit this error for files in the current session
  // so the working directory can only be the current working directory
  const filename: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
  const source = sm.new_source_file(filename, Str.from(contents_));

  // Avoid out-of-bounds span from lossy UTF-8 conversion.
  if (start > source.normalized_source_len) {
    err.note(note);
    return;
  }

  const span = Span.with_root_ctxt(source.normalized_byte_pos(start), source.normalized_byte_pos(start));
  if (Span.is_dummy(span)) {
    err.note(note);
  } else {
    if (sp !== undefined) {
      err.span_note(span, msg);
    } else {
      err.span(span);
      err.span_label(span, msg);
    }
  }
}

/// Given a session and a `source_file`, return a parser. Returns any buffered errors from lexing
/// the initial token stream.
// rustc: compiler/rustc_parse/src/lib.rs:226 new_parser_from_source_file
function new_parser_from_source_file(
  psess: ParseSess,
  source_file: SourceFile,
  strip_tokens: StripTokens,
): Result<Parser, Diag[]> {
  const end_pos = source_file.end_position();
  const r = source_file_to_stream(psess, source_file, undefined, strip_tokens);
  if (r.$ === "Err") return r;
  const stream = r._0;
  const parser = Parser.new(psess, stream, undefined);
  if (parser.token.eq(token.TokenKind.Eof)) {
    // PORT: `parser.token.span = ..` on the (Copy) token: a new `Token` (rustc_ast/token.ts).
    parser.token = token.Token.new(parser.token.kind, Span.new(end_pos, end_pos, Span.ctxt(parser.token.span), undefined));
  }
  return Ok(parser);
}

/// Given a source string, produces a sequence of token trees.
///
/// NOTE: This only strips shebangs, not frontmatter!
// rustc: compiler/rustc_parse/src/lib.rs:243 source_str_to_stream
export function source_str_to_stream(
  psess: ParseSess,
  name: FileName,
  source: string,
  override_span: Span | undefined,
): Result<TokenStream, Diag[]> {
  const source_file = psess.source_map().new_source_file(name, Str.from(source));
  // FIXME(frontmatter): Consider stripping frontmatter in a future edition. We can't strip them
  // in the current edition since that would be breaking.
  // See also <https://github.com/rust-lang/rust/issues/145520>.
  // Alternatively, stop stripping shebangs here, too, if T-lang and crater approve.
  return source_file_to_stream(psess, source_file, override_span, StripTokens.Shebang);
}

/// Given a source file, produces a sequence of token trees.
///
/// Returns any buffered errors from parsing the token stream.
// rustc: compiler/rustc_parse/src/lib.rs:260 source_file_to_stream
function source_file_to_stream(
  psess: ParseSess,
  source_file: SourceFile,
  override_span: Span | undefined,
  strip_tokens: StripTokens,
): Result<TokenStream, Diag[]> {
  const src = source_file.src;
  if (src === undefined) {
    return psess
      .dcx()
      .bug(
        `cannot lex \`source_file\` without source: ${psess.source_map().filename_for_diagnostics(source_file.name).to_string()}`,
      );
  }

  return lex_token_trees(psess, src, source_file.start_pos, override_span, strip_tokens);
}

/// Runs the given subparser `f` on the tokens of the given `attr`'s item.
// rustc: compiler/rustc_parse/src/lib.rs:277 parse_in
export function parse_in<T>(
  psess: ParseSess,
  tts: TokenStream,
  name: string,
  f: (this_: Parser) => PResult<T>,
): PResult<T> {
  const parser = Parser.new(psess, tts, name);
  const r = f(parser);
  if (r.$ === "Err") return r;
  const result = r._0;
  if (!parser.token.eq(token.TokenKind.Eof)) {
    const r2 = parser.unexpected();
    if (r2.$ === "Err") return r2;
  }
  return Ok(result);
}

// rustc: compiler/rustc_parse/src/lib.rs:291 fake_token_stream_for_item
export function fake_token_stream_for_item(
  psess: ParseSess,
  item: ast.Item,
  attr_to_exclude: ast.Attribute | undefined,
): TokenStream {
  const tokens = fake_token_stream_for_file_mod(psess, item, attr_to_exclude);
  if (tokens !== undefined) {
    return tokens;
  }

  const source = pprust.item_to_string(item);
  const filename = FileName.macro_expansion_source_code(source);
  return unwrap_or_emit_fatal(source_str_to_stream(psess, filename, source, item.span));
}

// rustc: compiler/rustc_parse/src/lib.rs:305 fake_token_stream_for_file_mod
function fake_token_stream_for_file_mod(
  psess: ParseSess,
  item: ast.Item,
  attr_to_exclude: ast.Attribute | undefined,
): TokenStream | undefined {
  const k = item.kind;
  if (!(k.$ === "Mod" && k._2.$ === "Loaded" && k._2._1.$ === "No")) {
    return undefined;
  }
  const spans = k._2._2;

  if (attr_to_exclude === undefined) {
    // `Option::expect` panics with the message.
    return panic("file modules must have an attribute to exclude");
  }
  const attr = attr_to_exclude;
  assert_eq(attr.style, ast.AttrStyle.Inner, (v) => v);

  const body_tts: TokenTree[] = [];
  const t1 = lex_token_trees_for_span(psess, Span.until(spans.inner_span, attr.span));
  if (t1 === undefined) return undefined;
  body_tts.push(...t1);
  const t2 = lex_token_trees_for_span(psess, Span.between(attr.span, Span.shrink_to_hi(spans.inner_span)));
  if (t2 === undefined) return undefined;
  body_tts.push(...t2);

  const wrapper_tts: TokenTree[] = [];
  for (const attr_ of item.attrs.filter((attr_) => attr_.style === ast.AttrStyle.Outer)) {
    wrapper_tts.push(...attr_.token_trees());
  }
  const t3 = lex_token_trees_for_span(psess, item.span);
  if (t3 === undefined) return undefined;
  wrapper_tts.push(...t3);
  const last = wrapper_tts.pop();
  if (last === undefined || last.$ !== "Token") {
    return undefined;
  }
  const semi = last._0;
  if (semi.kind.$ !== "Semi") {
    return undefined;
  }
  wrapper_tts.push({
    $: "Delimited",
    _0: tokenstream.DelimSpan.from_single(semi.span),
    _1: tokenstream.DelimSpacing.new(tokenstream.Spacing.Alone, tokenstream.Spacing.Alone),
    _2: token.Delimiter.Brace,
    _3: tokenstream.TokenStream.new(body_tts),
  });

  return tokenstream.TokenStream.new(wrapper_tts);
}

// rustc: compiler/rustc_parse/src/lib.rs:347 lex_token_trees_for_span
function lex_token_trees_for_span(psess: ParseSess, span: Span): TokenTree[] | undefined {
  const s = psess.source_map().span_to_snippet(span);
  if (s.$ === "Err") return undefined;
  const src = s._0;
  let stream: TokenStream;
  const r = lex_token_trees(psess, src, Span.lo(span), undefined, StripTokens.Nothing);
  switch (r.$) {
    case "Ok":
      stream = r._0;
      break;
    case "Err": {
      const errs = r._0;
      for (const err of errs) err.cancel();
      return undefined;
    }
  }
  // PORT: `(0..).map_while(move |index| stream.get(index).cloned())`, collected eagerly (every
  // caller extends a Vec with it right away).
  const out: TokenTree[] = [];
  for (let index = 0; ; index++) {
    const t = stream.get(index);
    if (t === undefined) break;
    out.push(tokenstream.clone_TokenTree(t));
  }
  return out;
}

// rustc: compiler/rustc_parse/src/lib.rs:362 fake_token_stream_for_foreign_item
export function fake_token_stream_for_foreign_item(psess: ParseSess, item: ast.ForeignItem): TokenStream {
  const source = pprust.foreign_item_to_string(item);
  const filename = FileName.macro_expansion_source_code(source);
  return unwrap_or_emit_fatal(source_str_to_stream(psess, filename, source, item.span));
}

// rustc: compiler/rustc_parse/src/lib.rs:371 fake_token_stream_for_crate
export function fake_token_stream_for_crate(psess: ParseSess, krate: ast.Crate): TokenStream {
  const source = pprust.crate_to_string_for_macros(krate);
  const filename = FileName.macro_expansion_source_code(source);
  return unwrap_or_emit_fatal(source_str_to_stream(psess, filename, source, krate.spans.inner_span));
}
