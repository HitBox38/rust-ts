// Port of compiler/rustc_ast_pretty/src/pprust/state.rs
//! AST pretty printing.
//!
//! Note that HIR pretty printing is layered on top of this crate.
//
// PORT: `mod expr; mod fixup; mod item;` -- `fixup` is imported below. `expr.rs` and `item.rs`
// extend `State` (PORTING §5 "Methods defined in another file"); this module must not import them.
// Their methods that this file calls are declared on the `State` interface below and get
// `unported(...)` placeholders until the expr/item lane assigns the real `State.prototype` methods.
//
// PORT: `trait PrintState<'a>: Deref<Target = pp::Printer> + DerefMut` -> the abstract class
// `PrintState`. Provided (default) methods are its methods; required methods are `abstract`.
// Implementors (`State` here, `rustc_hir_pretty::State` later) `extend` it. The `Deref` supertrait
// is the abstract field `s: pp.Printer` (both upstream implementors deref to their `s` field);
// auto-deref calls `self.word(..)` are written `this.s.word(..)`. Trait-provided associated fns
// (`Self::to_string`) are statics on `PrintState`.

import { ast, attr, token as tk } from "../../rustc_ast/lib.ts";
import type { Spacing, TokenStream, TokenTree } from "../../rustc_ast/tokenstream.ts";
import * as classify from "../../rustc_ast/util/classify.ts";
import { type Comment, CommentStyle } from "../../rustc_ast/util/comments.ts";
import { display_Lit } from "../../rustc_ast/token.ts";
import type { NodeId } from "../../rustc_ast/node_id.ts";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../../rustc_lexer/lib.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { BytePos, CharPos, DUMMY_SP, type FileName, Span } from "../../rustc_span/lib.ts";
import { Ident, IdentPrinter, Symbol, display_IdentPrinter, kw, sym } from "../../rustc_span/symbol.ts";
import { is_whitespace, len_utf8 } from "../../std/char.ts";
import { debug_str } from "../../std/fmt.ts";
import { panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Str, str_chars_count } from "../../std/str.ts";
import { in_table } from "../../std/unicode/mod.ts";
import { DEBUG_ESCAPE_UNICODE } from "../../std/unicode/tables.ts";
import * as pp from "../pp.ts";
import { type BoxMarker, Breaks } from "../pp.ts";
import { FixupContext } from "./state/fixup.ts";

// use crate::pp::Breaks::{Consistent, Inconsistent};
const Consistent: Breaks = Breaks.Consistent;
const Inconsistent: Breaks = Breaks.Inconsistent;

export type MacHeader =
  | { readonly $: "Path"; _0: ast.Path }
  | { readonly $: "Keyword"; _0: string };

export type AnnNode =
  | { readonly $: "Ident"; _0: Ident }
  | { readonly $: "Name"; _0: Symbol }
  | { readonly $: "Block"; _0: ast.Block }
  | { readonly $: "Item"; _0: ast.Item }
  | { readonly $: "SubItem"; _0: NodeId }
  | { readonly $: "Expr"; _0: ast.Expr }
  | { readonly $: "Pat"; _0: ast.Pat }
  | { readonly $: "Crate"; _0: ast.Crate };

// PORT: `trait PpAnn` (all methods provided) -> a class; implementors `extend` it and override.
export class PpAnn {
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:49 pre
  pre(_state: State, _node: AnnNode): void {}
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:50 post
  post(_state: State, _node: AnnNode): void {}
}

class NoAnn extends PpAnn {}

// impl PpAnn for NoAnn {}
// PORT: `&NoAnn` (a `'static` promoted constant) -> one shared instance.
const NO_ANN: PpAnn = new NoAnn();

/// Returns `None` if the first `col` chars of `s` contain a non-whitespace char.
/// Otherwise returns `Some(k)` where `k` is first char offset after that leading
/// whitespace. Note that `k` may be outside bounds of `s`.
// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:66 all_whitespace
function all_whitespace(s: Str, col: CharPos): number | undefined {
  let idx = 0;
  // for (i, ch) in s.char_indices().take(col.to_usize())
  const chars = s.chars();
  for (let n = 0; n < col; n++) {
    const i = chars.pos - s.lo;
    const ch = chars.next();
    if (ch === undefined) break;
    if (!is_whitespace(ch)) {
      return undefined;
    }
    idx = i + len_utf8(ch);
  }
  return idx;
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:77 trim_whitespace_prefix
function trim_whitespace_prefix(s: Str, col: CharPos): Str {
  const len = s.len();
  const r = all_whitespace(s, col);
  if (r !== undefined) {
    const col = r;
    if (col < len) {
      return s.slice(col);
    } else {
      return Str.from("");
    }
  } else {
    return s;
  }
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:91 split_block_comment_into_lines
function split_block_comment_into_lines(text: Str, col: CharPos): string[] {
  const res: string[] = [];
  const lines = text.lines();
  // just push the first line
  const first = lines.next();
  if (!first.done) res.push(first.value.toString());
  // for other lines, strip common whitespace prefix
  for (const line of lines) {
    res.push(trim_whitespace_prefix(line, col).toString());
  }
  return res;
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:103 gather_comments
function gather_comments(sm: SourceMap, path: FileName, src: Str): Comment[] {
  // PORT: `FilePathMapping: Clone` (derived) -> rebuilt from its fields.
  const pm = sm.path_mapping();
  sm = SourceMap.new(FilePathMapping.new(pm.mapping.slice(), pm.filename_remapping_scopes));
  const source_file = sm.new_source_file(path, src);
  const text: Str = unwrap(source_file.src);

  const start_bpos = source_file.start_pos;
  let pos = 0;
  const comments: Comment[] = [];
  let code_to_the_left = false;

  const shebang_len = strip_shebang(text);
  if (shebang_len !== undefined) {
    comments.push({
      style: CommentStyle.Isolated,
      lines: [text.slice(0, shebang_len).toString()],
      pos: start_bpos,
    });
    pos += shebang_len;
  }

  for (const token of tokenize(text.slice(pos), FrontmatterAllowed.Yes)) {
    const token_text = text.slice(pos, pos + token.len);
    const kind = token.kind;
    switch (kind.$) {
      case "Whitespace": {
        let idx = token_text.find("\n");
        if (idx !== undefined) {
          code_to_the_left = false;
          let next_newline: number | undefined;
          while ((next_newline = token_text.slice(idx + 1).find("\n")) !== undefined) {
            idx += 1 + next_newline;
            comments.push({
              style: CommentStyle.BlankLine,
              lines: [],
              pos: BytePos(start_bpos + (pos + idx)),
            });
          }
        }
        break;
      }
      case "BlockComment": {
        if (kind.doc_style === undefined) {
          const next = text.slice(pos + token.len).chars().next();
          const code_to_the_right = !(next === 0x0d || next === 0x0a);
          let style: CommentStyle;
          if (code_to_the_right) {
            style = CommentStyle.Mixed;
          } else if (!code_to_the_left) {
            style = CommentStyle.Isolated;
          } else {
            style = CommentStyle.Trailing;
          }

          // Count the number of chars since the start of the line by rescanning.
          const pos_in_file = BytePos(start_bpos + pos);
          const line_begin_in_file = source_file.line_begin_pos(pos_in_file);
          const line_begin_pos = line_begin_in_file - start_bpos;
          const col = CharPos(str_chars_count(text.slice(line_begin_pos, pos)));

          const lines = split_block_comment_into_lines(token_text, col);
          comments.push({ style, lines, pos: pos_in_file });
        }
        break;
      }
      case "LineComment": {
        if (kind.doc_style === undefined) {
          comments.push({
            style: code_to_the_left ? CommentStyle.Trailing : CommentStyle.Isolated,
            lines: [token_text.toString()],
            pos: BytePos(start_bpos + pos),
          });
        }
        break;
      }
      case "Frontmatter": {
        code_to_the_left = false;
        comments.push({
          style: CommentStyle.Isolated,
          lines: [token_text.toString()],
          pos: BytePos(start_bpos + pos),
        });
        break;
      }
      default: {
        code_to_the_left = true;
      }
    }
    pos += token.len;
  }

  return comments;
}

export class Comments {
  constructor(
    public sm: SourceMap,
    // Stored in reverse order so we can consume them by popping.
    public reversed_comments: Comment[],
  ) {}

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:193 new
  static new(sm: SourceMap, filename: FileName, input: Str): Comments {
    const comments = gather_comments(sm, filename, input);
    comments.reverse();
    return new Comments(sm, comments);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:199 peek
  peek(): Comment | undefined {
    return this.reversed_comments[this.reversed_comments.length - 1];
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:203 next
  next(): Comment | undefined {
    return this.reversed_comments.pop();
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:207 trailing_comment
  trailing_comment(span: Span, next_pos: BytePos | undefined): Comment | undefined {
    const cmnt = this.peek();
    if (cmnt !== undefined) {
      if (cmnt.style !== CommentStyle.Trailing) {
        return undefined;
      }
      const span_line = this.sm.lookup_char_pos(Span.hi(span));
      const comment_line = this.sm.lookup_char_pos(cmnt.pos);
      const next = next_pos ?? BytePos(cmnt.pos + 1);
      if (Span.hi(span) < cmnt.pos && cmnt.pos < next && span_line.line === comment_line.line) {
        return unwrap(this.next());
      }
    }

    return undefined;
  }
}

// PORT: `pub struct State<'a> { s, comments, ann, is_sdylib_interface }` is the class `State`
// below (it must follow `PrintState`, which it extends).

export const INDENT_UNIT: number = 4;

/// Requires you to pass an input filename and reader so that
/// it can scan the input text for comments to copy forward.
// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:239 print_crate
export function print_crate(
  sm: SourceMap,
  krate: ast.Crate,
  filename: FileName,
  input: Str,
  ann: PpAnn,
  is_expanded: boolean,
  edition: Edition,
  g: attr.AttrIdGenerator,
): string {
  const s = new State(pp.Printer.new(), Comments.new(sm, filename, input), ann, false);

  print_crate_inner(s, krate, is_expanded, edition, g);
  return s.s.eof();
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:260 print_crate_as_interface
export function print_crate_as_interface(krate: ast.Crate, edition: Edition, g: attr.AttrIdGenerator): string {
  const s = new State(pp.Printer.new(), undefined, NO_ANN, true);

  print_crate_inner(s, krate, false, edition, g);
  return s.s.eof();
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:272 print_crate_inner
function print_crate_inner(
  s: State,
  krate: ast.Crate,
  is_expanded: boolean,
  edition: Edition,
  g: attr.AttrIdGenerator,
): void {
  // We need to print shebang before anything else
  // otherwise the resulting code will not compile
  // and shebang will be useless.
  s.maybe_print_shebang();

  if (is_expanded && !krate.attrs.some((attr) => attr.has_name(sym.no_core))) {
    // We need to print `#![no_std]` (and its feature gate) so that
    // compiling pretty-printed source won't inject libstd again.
    // However, we don't want these attributes in the AST because
    // of the feature gate, so we fake them up here.

    // `#![feature(prelude_import)]`
    const fake_attr = attr.mk_attr_nested_word(g, "Inner", sym.feature, sym.prelude_import, DUMMY_SP);
    s.print_attribute(fake_attr);

    // Currently, in Rust 2018 we don't have `extern crate std;` at the crate
    // root, so this is not needed, and actually breaks things.
    if (Edition.is_rust_2015(edition)) {
      // `#![no_std]`
      const fake_attr = attr.mk_attr_word(g, "Inner", sym.no_std, DUMMY_SP);
      s.print_attribute(fake_attr);
    }
  }

  s.print_inner_attributes(krate.attrs);
  for (const item of krate.items) {
    s.print_item(item);
  }
  s.print_remaining_comments();
  s.ann.post(s, { $: "Crate", _0: krate });
}

/// Should two consecutive tokens be printed with a space between them?
///
/// Note: some old proc macros parse pretty-printed output, so changes here can
/// break old code. For example:
/// - #63896: `#[allow(unused,` must be printed rather than `#[allow(unused ,`
/// - #73345: `#[allow(unused)]` must be printed rather than `# [allow(unused)]`
///
/// Returns `true` if both token trees are identifier-like tokens that would
/// merge into a single token if printed without a space between them.
/// E.g. `ident` + `where` would merge into `identwhere`.
// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:327 idents_would_merge
function idents_would_merge(tt1: TokenTree, tt2: TokenTree): boolean {
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:328 is_ident_like
  function is_ident_like(tt: TokenTree): boolean {
    return tt.$ === "Token" && (tt._0.kind.$ === "Ident" || tt._0.kind.$ === "NtIdent");
  }
  return is_ident_like(tt1) && is_ident_like(tt2);
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:334 space_between
function space_between(tt1: TokenTree, tt2: TokenTree): boolean {
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:338 is_punct
  function is_punct(tt: TokenTree): boolean {
    return tt.$ === "Token" && tt._0.is_punct();
  }

  // Each match arm has one or more examples in comments. The default is to
  // insert space between adjacent tokens, except for the cases listed in
  // this match.
  const k1 = tt1.$ === "Token" ? tt1._0.kind : undefined;
  const k2 = tt2.$ === "Token" ? tt2._0.kind : undefined;

  // No space after line doc comments.
  if (k1 !== undefined && k1.$ === "DocComment" && k1._0 === tk.CommentKind.Line) {
    return false;
  }

  // `.` + NON-PUNCT: `x.y`, `tup.0`
  if (k1 !== undefined && k1.$ === "Dot" && !is_punct(tt2)) {
    return false;
  }

  // `$` + IDENT: `$e`
  if (k1 !== undefined && k1.$ === "Dollar" && k2 !== undefined && k2.$ === "Ident") {
    return false;
  }

  // NON-PUNCT + `,`: `foo,`
  // NON-PUNCT + `;`: `x = 3;`, `[T; 3]`
  // NON-PUNCT + `.`: `x.y`, `tup.0`
  if (k2 !== undefined && (k2.$ === "Comma" || k2.$ === "Semi" || k2.$ === "Dot") && !is_punct(tt1)) {
    return false;
  }

  // IDENT + `!`: `println!()`, but `if !x { ... }` needs a space after the `if`
  if (tt1.$ === "Token" && k1 !== undefined && k1.$ === "Ident" && k2 !== undefined && k2.$ === "Bang") {
    const [sym_, kind] = [k1._0, k1._1];
    const span = tt1._0.span;
    if (!Ident.new(sym_, span).is_reserved() || kind === tk.IdentKind.Raw) {
      return false;
    }
  }

  // IDENT|`fn`|`Self`|`pub` + `(`: `f(3)`, `fn(x: u8)`, `Self()`, `pub(crate)`,
  //      but `let (a, b) = (1, 2)` needs a space after the `let`
  if (tt1.$ === "Token" && k1 !== undefined && k1.$ === "Ident" && tt2.$ === "Delimited" && tt2._2.$ === "Parenthesis") {
    const [sym_, kind] = [k1._0, k1._1];
    const span = tt1._0.span;
    if (
      kind === tk.IdentKind.Raw ||
      sym_ === kw.Fn ||
      sym_ === kw.SelfUpper ||
      sym_ === kw.Pub ||
      !Ident.new(sym_, span).is_reserved()
    ) {
      return false;
    }
  }

  // `#` + `[`: `#[attr]`
  if (k1 !== undefined && k1.$ === "Pound" && tt2.$ === "Delimited" && tt2._2.$ === "Bracket") {
    return false;
  }

  return true;
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:388 doc_comment_to_string
export function doc_comment_to_string(
  fragment_kind: tk.DocFragmentKind,
  attr_style: ast.AttrStyle,
  data: Symbol,
): string {
  switch (fragment_kind.$) {
    case "Sugared": {
      const comment_kind = fragment_kind._0;
      if (comment_kind === "Line" && attr_style === "Outer") return `///${Symbol.as_str(data)}`;
      if (comment_kind === "Line" && attr_style === "Inner") return `//!${Symbol.as_str(data)}`;
      if (comment_kind === "Block" && attr_style === "Outer") return `/**${Symbol.as_str(data)}*/`;
      // (tk::CommentKind::Block, ast::AttrStyle::Inner)
      return `/*!${Symbol.as_str(data)}*/`;
    }
    case "Raw": {
      return `#${attr_style === "Inner" ? "!" : ""}[doc = ${debug_str(Symbol.as_str(data))}]`;
    }
  }
}

// rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:410 literal_to_string
function literal_to_string(lit: tk.Lit): string {
  const { kind, symbol, suffix } = lit;
  const sym_ = Symbol.as_str(symbol);
  let out: string;
  switch (kind.$) {
    case "Byte":
      out = `b'${sym_}'`;
      break;
    case "Char":
      out = `'${sym_}'`;
      break;
    case "Str":
      out = `"${sym_}"`;
      break;
    case "StrRaw": {
      const delim = "#".repeat(kind._0);
      out = `r${delim}"${sym_}"${delim}`;
      break;
    }
    case "ByteStr":
      out = `b"${sym_}"`;
      break;
    case "ByteStrRaw": {
      const delim = "#".repeat(kind._0);
      out = `br${delim}"${sym_}"${delim}`;
      break;
    }
    case "CStr":
      out = `c"${sym_}"`;
      break;
    case "CStrRaw": {
      const delim = "#".repeat(kind._0);
      out = `cr${delim}"${sym_}"${delim}`;
      break;
    }
    case "Integer":
    case "Float":
    case "Bool":
    case "Err":
      out = sym_;
      break;
  }

  if (suffix !== undefined) {
    out += Symbol.as_str(suffix);
  }

  return out;
}

// PORT: `str::escape_debug` (library/core/src/str/mod.rs:3149 at the pin) is
// `self.chars().flat_map(CharEscapeDebug)`, i.e. `char::escape_debug` (`EscapeDebugExtArgs::ESCAPE_ALL`:
// both quote kinds and grapheme-extended chars escaped) on every char. `DEBUG_ESCAPE_UNICODE`
// (src/std, generated from the oracle) is exactly `char::escape_debug`'s `\u{..}` set.
function str_escape_debug(s: string): string {
  let out = "";
  for (const c_ of s) {
    const c = c_.codePointAt(0)!;
    switch (c) {
      case 0x00:
        out += "\\0";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0d:
        out += "\\r";
        break;
      case 0x5c:
        out += "\\\\";
        break;
      case 0x22:
        out += '\\"';
        break;
      case 0x27:
        out += "\\'";
        break;
      default:
        if (c >= 0x20 && c < 0x7f) {
          out += c_;
        } else if (in_table(DEBUG_ESCAPE_UNICODE, c)) {
          out += "\\u{" + c.toString(16) + "}";
        } else {
          out += c_;
        }
    }
  }
  return out;
}

/// This trait is used for both AST and HIR pretty-printing.
export abstract class PrintState {
  // PORT: the `Deref<Target = pp::Printer> + DerefMut` supertraits (see the header comment).
  abstract s: pp.Printer;

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:452 comments
  abstract comments(): Comments | undefined;
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:453 comments_mut
  abstract comments_mut(): Comments | undefined;
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:454 ann_post
  abstract ann_post(ident: Ident): void;
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:455 print_generic_args
  abstract print_generic_args(args: ast.GenericArgs, colons_before_params: boolean): void;

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:457 print_ident
  print_ident(ident: Ident): void {
    this.s.word(display_IdentPrinter(IdentPrinter.for_ast_ident(ident, ident.guess_print_mode())));
    this.ann_post(ident);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:462 strsep
  strsep<T>(
    sep: string,
    space_before: boolean,
    b: Breaks,
    elts: Iterable<T>,
    op: (s: this, elt: T) => void,
  ): void {
    const it = elts[globalThis.Symbol.iterator]();

    const rb = this.s.rbox(0, b);
    const first = it.next();
    if (!first.done) {
      op(this, first.value);
      for (let r = it.next(); !r.done; r = it.next()) {
        const elt = r.value;
        if (space_before) {
          this.s.space();
        }
        this.s.word_space(sep);
        op(this, elt);
      }
    }
    this.s.end(rb);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:489 commasep
  commasep<T>(b: Breaks, elts: Iterable<T>, op: (s: this, elt: T) => void): void {
    this.strsep(",", false, b, elts, op);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:497 maybe_print_comment
  maybe_print_comment(pos: BytePos): boolean {
    let has_comment = false;
    let cmnt: Comment | undefined;
    while ((cmnt = this.peek_comment()) !== undefined) {
      if (cmnt.pos >= pos) {
        break;
      }
      has_comment = true;
      const cmnt_ = unwrap(this.next_comment());
      this.print_comment(cmnt_);
    }
    return has_comment;
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:510 print_comment
  print_comment(cmnt: Comment): void {
    switch (cmnt.style) {
      case CommentStyle.Mixed: {
        if (!this.s.is_beginning_of_line()) {
          this.s.zerobreak();
        }
        // if let Some((last, lines)) = cmnt.lines.split_last()
        if (cmnt.lines.length > 0) {
          const last = cmnt.lines[cmnt.lines.length - 1]!;
          const lines = cmnt.lines.slice(0, -1);
          const ib = this.s.ibox(0);

          for (const line of lines) {
            this.s.word(line);
            this.s.hardbreak();
          }

          this.s.word(last);
          this.s.space();

          this.s.end(ib);
        }
        this.s.zerobreak();
        break;
      }
      case CommentStyle.Isolated: {
        this.s.hardbreak_if_not_bol();
        for (const line of cmnt.lines) {
          // Don't print empty lines because they will end up as trailing
          // whitespace.
          if (line !== "") {
            this.s.word(line);
          }
          this.s.hardbreak();
        }
        break;
      }
      case CommentStyle.Trailing: {
        if (!this.s.is_beginning_of_line()) {
          this.s.word(" ");
        }
        if (cmnt.lines.length === 1) {
          const line = cmnt.lines[0]!;
          this.s.word(line);
          this.s.hardbreak();
        } else {
          const vb = this.s.visual_align();
          for (const line of cmnt.lines) {
            if (line !== "") {
              this.s.word(line);
            }
            this.s.hardbreak();
          }
          this.s.end(vb);
        }
        break;
      }
      case CommentStyle.BlankLine: {
        // We need to do at least one, possibly two hardbreaks.
        const last = this.s.last_token();
        let twice: boolean;
        if (last !== undefined && last.$ === "String") {
          twice = ";" === last._0;
        } else if (last !== undefined && last.$ === "Begin") {
          twice = true;
        } else if (last !== undefined && last.$ === "End") {
          twice = true;
        } else {
          twice = false;
        }
        if (twice) {
          this.s.hardbreak();
        }
        this.s.hardbreak();
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:576 peek_comment
  peek_comment(): Comment | undefined {
    const c = this.comments();
    return c === undefined ? undefined : c.peek();
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:583 next_comment
  next_comment(): Comment | undefined {
    const c = this.comments_mut();
    return c === undefined ? undefined : c.next();
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:587 maybe_print_trailing_comment
  maybe_print_trailing_comment(span: Span, next_pos: BytePos | undefined): void {
    const cmnts = this.comments_mut();
    if (cmnts !== undefined) {
      const cmnt = cmnts.trailing_comment(span, next_pos);
      if (cmnt !== undefined) {
        this.print_comment(cmnt);
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:595 print_remaining_comments
  print_remaining_comments(): void {
    // If there aren't any remaining comments, then we need to manually
    // make sure there is a line break at the end.
    if (this.peek_comment() === undefined) {
      this.s.hardbreak();
    }
    let cmnt: Comment | undefined;
    while ((cmnt = this.next_comment()) !== undefined) {
      this.print_comment(cmnt);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:606 print_string
  print_string(st: string, style: ast.StrStyle): void {
    let st_: string;
    switch (style.$) {
      case "Cooked":
        st_ = `"${str_escape_debug(st)}"`;
        break;
      case "Raw": {
        const delim = "#".repeat(style._0);
        st_ = `r${delim}"${st}"${delim}`;
        break;
      }
    }
    this.s.word(st_);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:616 maybe_print_shebang
  maybe_print_shebang(): void {
    const cmnt = this.peek_comment();
    if (cmnt !== undefined) {
      // Comment is a shebang if it's:
      // Isolated, starts with #! and doesn't continue with `[`
      // See [rustc_lexer::strip_shebang] and [gather_comments] from pprust/state.rs for details
      if (cmnt.style === CommentStyle.Isolated && cmnt.lines.length > 0 && cmnt.lines[0]!.startsWith("#!")) {
        const cmnt_ = unwrap(this.next_comment());
        this.print_comment(cmnt_);
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:630 print_inner_attributes
  print_inner_attributes(attrs: readonly ast.Attribute[]): boolean {
    return this.print_either_attributes(attrs, "Inner", false, true);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:634 print_outer_attributes
  print_outer_attributes(attrs: readonly ast.Attribute[]): boolean {
    return this.print_either_attributes(attrs, "Outer", false, true);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:638 print_either_attributes
  print_either_attributes(
    attrs: readonly ast.Attribute[],
    kind: ast.AttrStyle,
    is_inline: boolean,
    trailing_hardbreak: boolean,
  ): boolean {
    let printed = false;
    for (const attr of attrs) {
      if (attr.style === kind) {
        if (this.print_attribute_inline(attr, is_inline)) {
          if (is_inline) {
            this.s.nbsp();
          }
          printed = true;
        }
      }
    }
    if (printed && trailing_hardbreak && !is_inline) {
      this.s.hardbreak_if_not_bol();
    }
    return printed;
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:662 print_attribute_inline
  print_attribute_inline(attr: ast.Attribute, is_inline: boolean): boolean {
    switch (attr.kind.$) {
      case "Synthetic": {
        const k = attr.kind._0;
        if (k.$ === "CfgTrace" || k.$ === "CfgAttrTrace") {
          // These are internal synthetic attributes with no syntax, so avoid printing them
          // to keep the printed code reasonably parse-able.
          return false;
        }
        break;
      }
      case "Normal":
      case "DocComment":
        break;
    }
    if (!is_inline) {
      this.s.hardbreak_if_not_bol();
    }
    this.maybe_print_comment(Span.lo(attr.span));
    const kind = attr.kind;
    switch (kind.$) {
      case "Normal": {
        const normal = kind._0;
        switch (attr.style) {
          case "Inner":
            this.s.word("#![");
            break;
          case "Outer":
            this.s.word("#[");
            break;
        }
        this.print_attr_item(normal.item, attr.span);
        this.s.word("]");
        break;
      }
      case "Synthetic":
        unreachable(); // due to early return above
      // falls through
      case "DocComment": {
        const comment_kind = kind._0;
        const data = kind._1;
        this.s.word(doc_comment_to_string({ $: "Sugared", _0: comment_kind }, attr.style, data));
        this.s.hardbreak();
        break;
      }
    }
    return true;
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:698 print_attr_item
  print_attr_item(item: ast.AttrItem, span: Span): void {
    const ib = this.s.ibox(0);
    switch (item.unsafety.$) {
      case "Unsafe":
        this.s.word("unsafe");
        this.s.popen();
        break;
      case "Default":
      case "Safe":
        break;
    }
    const args = item.args;
    switch (args.$) {
      case "Delimited": {
        const { delim, tokens } = args._0;
        this.print_mac_common(
          { $: "Path", _0: item.path },
          false,
          undefined,
          delim,
          undefined,
          tokens,
          true,
          span,
        );
        break;
      }
      case "Empty": {
        this.print_path(item.path, false, 0);
        break;
      }
      case "Eq": {
        const expr = args.expr;
        this.print_path(item.path, false, 0);
        this.s.space();
        this.s.word_space("=");
        const token_str = this.expr_to_string(expr);
        this.s.word(token_str);
        break;
      }
    }
    switch (item.unsafety.$) {
      case "Unsafe":
        this.s.pclose();
        break;
      case "Default":
      case "Safe":
        break;
    }
    this.s.end(ib);
  }

  /// This doesn't deserve to be called "pretty" printing, but it should be
  /// meaning-preserving. A quick hack that might help would be to look at the
  /// spans embedded in the TTs to decide where to put spaces and newlines.
  /// But it'd be better to parse these according to the grammar of the
  /// appropriate macro, transcribe back into the grammar we just parsed from,
  /// and then pretty-print the resulting AST nodes (so, e.g., we print
  /// expression arguments as expressions). It can be done! I think.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:743 print_tt
  print_tt(tt: TokenTree, convert_dollar_crate: boolean): Spacing {
    switch (tt.$) {
      case "Token": {
        const token = tt._0;
        const spacing = tt._1;
        const token_str = this.token_to_string_ext(token, convert_dollar_crate);
        this.s.word(token_str);
        // Emit hygiene annotations for identity-bearing tokens,
        // matching how print_ident() and print_lifetime() call ann_post().
        const k = token.kind;
        switch (k.$) {
          case "Ident": {
            this.ann_post(Ident.new(k._0, token.span));
            break;
          }
          case "NtIdent": {
            this.ann_post(k._0);
            break;
          }
          case "Lifetime": {
            this.ann_post(Ident.new(k._0, token.span));
            break;
          }
          case "NtLifetime": {
            this.ann_post(k._0);
            break;
          }
          default:
            break;
        }
        if (token.kind.$ === "DocComment") {
          this.s.hardbreak();
        }
        return spacing;
      }
      case "Delimited": {
        const dspan = tt._0;
        const spacing = tt._1;
        const delim = tt._2;
        const tts = tt._3;
        this.print_mac_common(
          undefined,
          false,
          undefined,
          delim,
          spacing.open,
          tts,
          convert_dollar_crate,
          dspan.entire(),
        );
        return spacing.close;
      }
    }
  }

  // The easiest way to implement token stream pretty printing would be to
  // print each token followed by a single space. But that would produce ugly
  // output, so we go to some effort to do better.
  //
  // First, we track whether each token that appears in source code is
  // followed by a space, with `Spacing`, and reproduce that in the output.
  // This works well in a lot of cases. E.g. `stringify!(x + y)` produces
  // "x + y" and `stringify!(x+y)` produces "x+y".
  //
  // But this doesn't work for code produced by proc macros (which have no
  // original source text representation) nor for code produced by decl
  // macros (which are tricky because the whitespace after tokens appearing
  // in macro rules isn't always what you want in the produced output). For
  // these we mostly use `Spacing::Alone`, which is the conservative choice.
  //
  // So we have a backup mechanism for when `Spacing::Alone` occurs between a
  // pair of tokens: we check if that pair of tokens can obviously go
  // together without a space between them. E.g. token `x` followed by token
  // `,` is better printed as `x,` than `x ,`. (Even if the original source
  // code was `x ,`.)
  //
  // Finally, we must be careful about changing the output. tk::Token pretty
  // printing is used by `stringify!` and `impl Display for
  // proc_macro::TokenStream`, and some programs rely on the output having a
  // particular form, even though they shouldn't. In particular, some proc
  // macros do `format!({stream})` on a token stream and then "parse" the
  // output with simple string matching that can't handle whitespace changes.
  // E.g. we have seen cases where a proc macro can handle `a :: b` but not
  // `a::b`. See #117433 for some examples.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:815 print_tts
  print_tts(tts: TokenStream, convert_dollar_crate: boolean): void {
    const iter = tts.iter();
    let tt: TokenTree | undefined;
    while ((tt = iter.next()) !== undefined) {
      const spacing = this.print_tt(tt, convert_dollar_crate);
      const next = iter.peek();
      if (next !== undefined) {
        if (spacing === "Alone" && space_between(tt, next)) {
          this.s.space();
        } else if (spacing !== "Alone" && idents_would_merge(tt, next)) {
          // When tokens from macro `tt` captures preserve their
          // original `Joint`/`JointHidden` spacing, adjacent
          // identifier-like tokens can be concatenated without a
          // space (e.g. `$x:identwhere`). Insert a space to
          // prevent this.
          this.s.space();
        }
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:834 print_mac_common
  print_mac_common(
    header: MacHeader | undefined,
    has_bang: boolean,
    ident: Ident | undefined,
    delim: tk.Delimiter,
    open_spacing: Spacing | undefined,
    tts: TokenStream,
    convert_dollar_crate: boolean,
    span: Span,
  ): void {
    const cb = delim.$ === "Brace" ? this.s.cbox(INDENT_UNIT) : undefined;
    if (header !== undefined) {
      switch (header.$) {
        case "Path":
          this.print_path(header._0, false, 0);
          break;
        case "Keyword":
          this.s.word(header._0);
          break;
      }
    }
    if (has_bang) {
      this.s.word("!");
    }
    if (ident !== undefined) {
      this.s.nbsp();
      this.print_ident(ident);
    }
    switch (delim.$) {
      case "Brace": {
        if (header !== undefined || has_bang || ident !== undefined) {
          this.s.nbsp();
        }
        this.s.word("{");

        // Respect `Alone`, if provided, and print a space. Unless the list is empty.
        const open_space = (open_spacing === undefined || open_spacing === "Alone") && !tts.is_empty();
        if (open_space) {
          this.s.space();
        }
        const ib = this.s.ibox(0);
        this.print_tts(tts, convert_dollar_crate);
        this.s.end(ib);

        // Use `open_space` for the spacing *before* the closing delim.
        // Because spacing on delimiters is lost when going through
        // proc macros, and otherwise we can end up with ugly cases
        // like `{ x}`. Symmetry is better.
        this.bclose(span, !open_space, unwrap(cb));
        break;
      }
      default: {
        // `open_spacing` is ignored. We never print spaces after
        // non-brace opening delims or before non-brace closing delims.
        const token_str = this.token_kind_to_string(tk.Delimiter.as_open_token_kind(delim));
        this.s.word(token_str);
        const ib = this.s.ibox(0);
        this.print_tts(tts, convert_dollar_crate);
        this.s.end(ib);
        const token_str_ = this.token_kind_to_string(tk.Delimiter.as_close_token_kind(delim));
        this.s.word(token_str_);
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:895 print_mac_def
  print_mac_def(macro_def: ast.MacroDef, ident: Ident, sp: Span, print_visibility: (s: this) => void): void {
    const eii_decl = macro_def.eii_declaration;
    if (eii_decl !== undefined) {
      this.s.word("#[eii_declaration(");
      this.print_path(eii_decl.foreign_item, false, 0);
      if (eii_decl.impl_unsafe) {
        this.s.word(",");
        this.s.space();
        this.s.word("unsafe");
      }
      this.s.word(")]");
      this.s.hardbreak();
    }
    let kw_: string;
    let has_bang: boolean;
    if (macro_def.macro_rules) {
      [kw_, has_bang] = ["macro_rules", true];
    } else {
      print_visibility(this);
      [kw_, has_bang] = ["macro", false];
    }
    this.print_mac_common(
      { $: "Keyword", _0: kw_ },
      has_bang,
      ident,
      macro_def.body.delim,
      undefined,
      macro_def.body.tokens,
      true,
      sp,
    );
    if (macro_def.body.need_semicolon()) {
      this.s.word(";");
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:934 print_path
  print_path(path: ast.Path, colons_before_params: boolean, depth: number): void {
    this.maybe_print_comment(Span.lo(path.span));

    const segments = path.segments.slice(0, path.segments.length - depth);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (i > 0) {
        this.s.word("::");
      }
      this.print_path_segment(segment, colons_before_params);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:945 print_path_segment
  print_path_segment(segment: ast.PathSegment, colons_before_params: boolean): void {
    if (segment.ident.name !== kw.PathRoot) {
      this.print_ident(segment.ident);
      const args = segment.args;
      if (args !== undefined) {
        this.print_generic_args(args, colons_before_params);
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:954 head
  head(w: string): [BoxMarker, BoxMarker] {
    // Outer-box is consistent.
    const cb = this.s.cbox(INDENT_UNIT);
    // Head-box is inconsistent.
    const ib = this.s.ibox(0);
    // Keyword that starts the head.
    if (w !== "") {
      this.s.word_nbsp(w);
    }
    return [cb, ib];
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:967 bopen
  bopen(ib: BoxMarker): void {
    this.s.word("{");
    this.s.end(ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:972 bclose_maybe_open
  bclose_maybe_open(span: Span, no_space: boolean, cb: BoxMarker | undefined): void {
    const has_comment = this.maybe_print_comment(Span.hi(span));
    if (!no_space || has_comment) {
      this.break_offset_if_not_bol(1, -INDENT_UNIT);
    }
    this.s.word("}");
    if (cb !== undefined) {
      this.s.end(cb);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:983 bclose
  bclose(span: Span, no_space: boolean, cb: BoxMarker): void {
    const cb_ = cb;
    this.bclose_maybe_open(span, no_space, cb_);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:988 break_offset_if_not_bol
  break_offset_if_not_bol(n: number, off: number): void {
    if (!this.s.is_beginning_of_line()) {
      this.s.break_offset(n, off);
    } else if (off !== 0) {
      const last_token = this.s.last_token_still_buffered();
      if (last_token !== undefined) {
        if (pp.Token.is_hardbreak_tok(last_token)) {
          // We do something pretty sketchy here: tuck the nonzero
          // offset-adjustment we were going to deposit along with the
          // break into the previous hardbreak.
          this.s.replace_last_token_still_buffered(pp.Printer.hardbreak_tok_offset(off));
        }
      }
    }
  }

  /// Print the token kind precisely, without converting `$crate` into its respective crate name.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1004 token_kind_to_string
  token_kind_to_string(tok: tk.TokenKind): string {
    return this.token_kind_to_string_ext(tok, undefined);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1008 token_kind_to_string_ext
  token_kind_to_string_ext(tok: tk.TokenKind, convert_dollar_crate: Span | undefined): string {
    switch (tok.$) {
      case "Eq":
        return "=";
      case "Lt":
        return "<";
      case "Le":
        return "<=";
      case "EqEq":
        return "==";
      case "Ne":
        return "!=";
      case "Ge":
        return ">=";
      case "Gt":
        return ">";
      case "Bang":
        return "!";
      case "Tilde":
        return "~";
      case "OrOr":
        return "||";
      case "AndAnd":
        return "&&";
      case "Plus":
        return "+";
      case "Minus":
        return "-";
      case "Star":
        return "*";
      case "Slash":
        return "/";
      case "Percent":
        return "%";
      case "Caret":
        return "^";
      case "And":
        return "&";
      case "Or":
        return "|";
      case "Shl":
        return "<<";
      case "Shr":
        return ">>";
      case "PlusEq":
        return "+=";
      case "MinusEq":
        return "-=";
      case "StarEq":
        return "*=";
      case "SlashEq":
        return "/=";
      case "PercentEq":
        return "%=";
      case "CaretEq":
        return "^=";
      case "AndEq":
        return "&=";
      case "OrEq":
        return "|=";
      case "ShlEq":
        return "<<=";
      case "ShrEq":
        return ">>=";

      /* Structural symbols */
      case "At":
        return "@";
      case "Dot":
        return ".";
      case "DotDot":
        return "..";
      case "DotDotDot":
        return "...";
      case "DotDotEq":
        return "..=";
      case "Comma":
        return ",";
      case "Semi":
        return ";";
      case "Colon":
        return ":";
      case "PathSep":
        return "::";
      case "RArrow":
        return "->";
      case "LArrow":
        return "<-";
      case "FatArrow":
        return "=>";
      case "OpenParen":
        return "(";
      case "CloseParen":
        return ")";
      case "OpenBracket":
        return "[";
      case "CloseBracket":
        return "]";
      case "OpenBrace":
        return "{";
      case "CloseBrace":
        return "}";
      case "OpenInvisible":
      case "CloseInvisible":
        return "";
      case "Pound":
        return "#";
      case "Dollar":
        return "$";
      case "Question":
        return "?";
      case "SingleQuote":
        return "'";

      /* Literals */
      case "Literal":
        return literal_to_string(tok._0);

      /* Name components */
      case "Ident": {
        const [name, kind] = [tok._0, tok._1];
        return display_IdentPrinter(IdentPrinter.new(name, tk.IdentKind.to_print_mode_ident(kind), convert_dollar_crate));
      }
      case "NtIdent": {
        const [ident, kind] = [tok._0, tok._1];
        return display_IdentPrinter(IdentPrinter.for_ast_ident(ident, tk.IdentKind.to_print_mode_ident(kind)));
      }

      case "Lifetime":
      case "NtLifetime": {
        const name = tok.$ === "Lifetime" ? tok._0 : tok._0.name;
        const kind = tok._1;
        return display_IdentPrinter(IdentPrinter.new(name, tk.IdentKind.to_print_mode_lifetime(kind), undefined));
      }

      /* Other */
      case "DocComment": {
        const [comment_kind, attr_style, data] = [tok._0, tok._1, tok._2];
        return doc_comment_to_string({ $: "Sugared", _0: comment_kind }, attr_style, data);
      }
      case "Eof":
        return "<eof>";
    }
  }

  /// Print the token precisely, without converting `$crate` into its respective crate name.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1098 token_to_string
  token_to_string(token: tk.Token): string {
    return this.token_to_string_ext(token, false);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1102 token_to_string_ext
  token_to_string_ext(token: tk.Token, convert_dollar_crate: boolean): string {
    const convert_dollar_crate_ = convert_dollar_crate ? token.span : undefined;
    return this.token_kind_to_string_ext(token.kind, convert_dollar_crate_);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1111 ty_to_string
  ty_to_string(ty: ast.Ty): string {
    return PrintState.to_string((s) => s.print_type(ty));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1115 pat_to_string
  pat_to_string(pat: ast.Pat): string {
    return PrintState.to_string((s) => s.print_pat(pat));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1119 expr_to_string
  expr_to_string(e: ast.Expr): string {
    return PrintState.to_string((s) => s.print_expr(e, FixupContext.default()));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1123 meta_item_lit_to_string
  meta_item_lit_to_string(lit: ast.MetaItemLit): string {
    return PrintState.to_string((s) => s.print_meta_item_lit(lit));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1127 stmt_to_string
  stmt_to_string(stmt: ast.Stmt): string {
    return PrintState.to_string((s) => s.print_stmt(stmt));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1131 item_to_string
  item_to_string(i: ast.Item): string {
    return PrintState.to_string((s) => s.print_item(i));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1135 assoc_item_to_string
  assoc_item_to_string(i: ast.AssocItem): string {
    return PrintState.to_string((s) => s.print_assoc_item(i));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1139 foreign_item_to_string
  foreign_item_to_string(i: ast.ForeignItem): string {
    return PrintState.to_string((s) => s.print_foreign_item(i));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1143 path_to_string
  path_to_string(p: ast.Path): string {
    return PrintState.to_string((s) => s.print_path(p, false, 0));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1147 vis_to_string
  vis_to_string(v: ast.Visibility): string {
    return PrintState.to_string((s) => s.print_visibility(v));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1151 impl_restriction_to_string
  impl_restriction_to_string(r: ast.ImplRestriction): string {
    return PrintState.to_string((s) => s.print_impl_restriction(r));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1155 mut_restriction_to_string
  mut_restriction_to_string(r: ast.MutRestriction): string {
    return PrintState.to_string((s) => s.print_mut_restriction(r));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1159 block_to_string
  block_to_string(blk: ast.Block): string {
    return PrintState.to_string((s) => {
      const [cb, ib] = s.head("");
      s.print_block(blk, cb, ib);
    });
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1166 attr_item_to_string
  attr_item_to_string(ai: ast.AttrItem): string {
    return PrintState.to_string((s) => s.print_attr_item(ai, ai.path.span));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1170 tts_to_string
  tts_to_string(tokens: TokenStream): string {
    return PrintState.to_string((s) => s.print_tts(tokens, false));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1174 to_string
  static to_string(f: (s: State) => void): string {
    const printer = State.new();
    f(printer);
    return printer.s.eof();
  }
}

export class State extends PrintState {
  constructor(
    public s: pp.Printer,
    // PORT: field `comments` is renamed `comments_` (it clashes with the `comments()` method).
    public comments_: Comments | undefined,
    public ann: PpAnn,
    public is_sdylib_interface: boolean,
  ) {
    super();
  }

  // impl std::ops::Deref for State<'_>
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:439 deref
  deref(): pp.Printer {
    return this.s;
  }

  // impl std::ops::DerefMut for State<'_>
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:445 deref_mut
  deref_mut(): pp.Printer {
    return this.s;
  }

  // impl<'a> PrintState<'a> for State<'a>

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1182 comments
  comments(): Comments | undefined {
    return this.comments_;
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1186 comments_mut
  comments_mut(): Comments | undefined {
    return this.comments_;
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1190 ann_post
  ann_post(ident: Ident): void {
    this.ann.post(this, { $: "Ident", _0: ident });
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1194 print_generic_args
  print_generic_args(args: ast.GenericArgs, colons_before_params: boolean): void {
    if (colons_before_params) {
      this.s.word("::");
    }

    switch (args.$) {
      case "AngleBracketed": {
        const data = args._0;
        this.s.word("<");
        this.commasep(Inconsistent, data.args, (s, arg) => {
          switch (arg.$) {
            case "Arg":
              return s.print_generic_arg(arg._0);
            case "Constraint":
              return s.print_assoc_item_constraint(arg._0);
          }
        });
        this.s.word(">");
        break;
      }

      case "Parenthesized": {
        const data = args._0;
        this.s.word("(");
        this.commasep(Inconsistent, data.inputs, (s, param) => s.print_param(param, false));
        this.s.word(")");
        this.print_fn_ret_ty(data.output);
        break;
      }
      case "ParenthesizedElided": {
        this.s.word("(");
        this.s.word("..");
        this.s.word(")");
        break;
      }
    }
  }

  // impl<'a> State<'a>

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1225 new
  static new(): State {
    return new State(pp.Printer.new(), undefined, NO_ANN, false);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1229 commasep_cmnt
  commasep_cmnt<T>(
    b: Breaks,
    elts: readonly T[],
    op: (s: State, elt: T) => void,
    get_span: (elt: T) => Span,
  ): void {
    const rb = this.s.rbox(0, b);
    const len = elts.length;
    let i = 0;
    for (const elt of elts) {
      this.maybe_print_comment(Span.hi(get_span(elt)));
      op(this, elt);
      i += 1;
      if (i < len) {
        this.s.word(",");
        this.maybe_print_trailing_comment(get_span(elt), Span.hi(get_span(elts[i]!)));
        this.s.space_if_not_bol();
      }
    }
    this.s.end(rb);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1250 commasep_exprs
  commasep_exprs(b: Breaks, exprs: readonly ast.Expr[]): void {
    this.commasep_cmnt(
      b,
      exprs,
      (s, e) => s.print_expr(e, FixupContext.default()),
      (e) => e.span,
    );
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1254 print_opt_lifetime
  print_opt_lifetime(lifetime: ast.Lifetime | undefined): void {
    if (lifetime !== undefined) {
      const lt = lifetime;
      this.print_lifetime(lt);
      this.s.nbsp();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1261 print_view
  print_view(fields: readonly Ident[]): void {
    this.s.word(".{");

    if (fields.length !== 0) {
      this.s.space();
      this.commasep(Consistent, fields, (s, field) => {
        s.print_ident(field);
      });
      this.s.space();
    }

    this.s.word("}");
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1275 print_assoc_item_constraint
  print_assoc_item_constraint(constraint: ast.AssocItemConstraint): void {
    this.print_ident(constraint.ident);
    const args = constraint.gen_args;
    if (args !== undefined) {
      this.print_generic_args(args, false);
    }
    this.s.space();
    const kind = constraint.kind;
    switch (kind.$) {
      case "Equality": {
        const term = kind.term;
        this.s.word_space("=");
        switch (term.$) {
          case "Ty":
            this.print_type(term._0);
            break;
          case "Const":
            this.print_expr_anon_const(term._0, []);
            break;
        }
        break;
      }
      case "Bound": {
        const bounds = kind.bounds;
        if (bounds.length !== 0) {
          this.s.word_nbsp(":");
          this.print_type_bounds(bounds);
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1298 print_generic_arg
  print_generic_arg(generic_arg: ast.GenericArg): void {
    switch (generic_arg.$) {
      case "Lifetime":
        return this.print_lifetime(generic_arg._0);
      case "Type":
        return this.print_type(generic_arg._0);
      case "Const":
        return this.print_expr(generic_arg._0.value, FixupContext.default());
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1306 print_ty_pat
  print_ty_pat(pat: ast.TyPat): void {
    const kind = pat.kind;
    switch (kind.$) {
      case "Range": {
        const [start, end, include_end] = [kind._0, kind._1, kind._2];
        if (start !== undefined) {
          this.print_expr_anon_const(start, []);
        }
        this.s.word("..");
        if (end !== undefined) {
          if (include_end.node.$ === "Included") {
            this.s.word("=");
          }
          this.print_expr_anon_const(end, []);
        }
        break;
      }
      case "NotNull":
        this.s.word("!null");
        break;
      case "Or": {
        const variants = kind._0;
        let first = true;
        for (const pat of variants) {
          if (first) {
            first = false;
          } else {
            this.s.word(" | ");
          }
          this.print_ty_pat(pat);
        }
        break;
      }
      case "Err": {
        this.s.popen();
        this.s.word("/*ERROR*/");
        this.s.pclose();
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1340 print_type
  print_type(ty: ast.Ty): void {
    this.maybe_print_comment(Span.lo(ty.span));
    const ib = this.s.ibox(0);
    const kind = ty.kind;
    switch (kind.$) {
      case "Slice": {
        this.s.word("[");
        this.print_type(kind._0);
        this.s.word("]");
        break;
      }
      case "Ptr": {
        const [ty, mutbl] = [kind._0, kind._1];
        this.s.word("*");
        this.print_mutability(mutbl, true);
        this.print_type(ty);
        break;
      }
      case "Ref": {
        const [lifetime, ty, mutbl] = [kind._0, kind._1, kind._2];
        this.s.word("&");
        this.print_opt_lifetime(lifetime);
        this.print_mutability(mutbl, false);
        this.print_type(ty);
        break;
      }
      case "PinnedRef": {
        const [lifetime, ty, mutbl] = [kind._0, kind._1, kind._2];
        this.s.word("&");
        this.print_opt_lifetime(lifetime);
        this.s.word("pin ");
        this.print_mutability(mutbl, true);
        this.print_type(ty);
        break;
      }
      case "Never": {
        this.s.word("!");
        break;
      }
      case "Tup": {
        const elts = kind._0;
        this.s.popen();
        this.commasep(Inconsistent, elts, (s, ty) => s.print_type(ty));
        if (elts.length === 1) {
          this.s.word(",");
        }
        this.s.pclose();
        break;
      }
      case "Paren": {
        this.s.popen();
        this.print_type(kind._0);
        this.s.pclose();
        break;
      }
      case "FnPtr": {
        const f = kind._0;
        this.print_ty_fn(f.ext, f.safety, f.decl, undefined, f.generic_params);
        break;
      }
      case "UnsafeBinder": {
        const f = kind._0;
        const ib = this.s.ibox(INDENT_UNIT);
        this.s.word("unsafe");
        this.print_generic_params(f.generic_params);
        this.s.nbsp();
        this.print_type(f.inner_ty);
        this.s.end(ib);
        break;
      }
      case "Path": {
        const [qself, path] = [kind._0, kind._1];
        if (qself === undefined) {
          this.print_path(path, false, 0);
        } else {
          this.print_qpath(path, qself, false);
        }
        break;
      }
      case "TraitObject": {
        const [bounds, syntax] = [kind._0, kind._1];
        switch (syntax) {
          case "Dyn":
            this.s.word_nbsp("dyn");
            break;
          case "None":
            break;
        }
        this.print_type_bounds(bounds);
        break;
      }
      case "ImplTrait": {
        const bounds = kind._1;
        this.s.word_nbsp("impl");
        this.print_type_bounds(bounds);
        break;
      }
      case "Array": {
        const [ty, length] = [kind._0, kind._1];
        this.s.word("[");
        this.print_type(ty);
        this.s.word("; ");
        this.print_expr(length.value, FixupContext.default());
        this.s.word("]");
        break;
      }
      case "Infer": {
        this.s.word("_");
        break;
      }
      case "Err": {
        this.s.popen();
        this.s.word("/*ERROR*/");
        this.s.pclose();
        break;
      }
      case "Dummy": {
        this.s.popen();
        this.s.word("/*DUMMY*/");
        this.s.pclose();
        break;
      }
      case "ImplicitSelf": {
        this.s.word("Self");
        break;
      }
      case "MacCall": {
        this.print_mac(kind._0);
        break;
      }
      case "CVarArgs": {
        this.s.word("...");
        break;
      }
      case "Pat": {
        const [ty, pat] = [kind._0, kind._1];
        this.print_type(ty);
        this.s.word(" is ");
        this.print_ty_pat(pat);
        break;
      }
      case "FieldOf": {
        const [ty, variant, field] = [kind._0, kind._1, kind._2];
        this.s.word("builtin # field_of");
        this.s.popen();
        const ib = this.s.ibox(0);
        this.print_type(ty);
        this.s.word(",");
        this.s.space();

        if (variant !== undefined) {
          this.print_ident(variant);
          this.s.word(".");
        }
        this.print_ident(field);

        this.s.end(ib);
        this.s.pclose();
        break;
      }
      case "View": {
        const [ty, fields] = [kind._0, kind._1];
        this.print_type(ty);
        this.print_view(fields);
        break;
      }
      case "GcaMacro": {
        const expr = kind._0;
        this.s.word_nbsp("core::gca!");
        this.s.popen();
        this.print_expr(expr, FixupContext.default());
        this.s.pclose();
        break;
      }
    }
    this.s.end(ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1474 print_trait_ref
  print_trait_ref(t: ast.TraitRef): void {
    this.print_path(t.path, false, 0);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1478 print_formal_generic_params
  print_formal_generic_params(generic_params: readonly ast.GenericParam[]): void {
    if (generic_params.length !== 0) {
      this.s.word("for");
      this.print_generic_params(generic_params);
      this.s.nbsp();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1486 print_poly_trait_ref
  print_poly_trait_ref(t: ast.PolyTraitRef): void {
    if (t.parens === "Yes") {
      this.s.popen();
    }
    this.print_formal_generic_params(t.bound_generic_params);

    const { constness, asyncness, polarity } = t.modifiers;
    switch (constness.$) {
      case "Never":
        break;
      case "Always":
      case "Maybe":
        this.s.word_space(ast.BoundConstness.as_str(constness));
        break;
    }
    switch (asyncness.$) {
      case "Normal":
        break;
      case "Async":
        this.s.word_space(ast.BoundAsyncness.as_str(asyncness));
        break;
    }
    switch (polarity.$) {
      case "Positive":
        break;
      case "Negative":
      case "Maybe":
        this.s.word(ast.BoundPolarity.as_str(polarity));
        break;
    }

    this.print_trait_ref(t.trait_ref);
    if (t.parens === "Yes") {
      this.s.pclose();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1518 print_stmt
  print_stmt(st: ast.Stmt): void {
    this.maybe_print_comment(Span.lo(st.span));
    const kind = st.kind;
    switch (kind.$) {
      case "Let": {
        const loc = kind._0;
        this.print_outer_attributes(loc.attrs);
        this.s.space_if_not_bol();
        const ib1 = this.s.ibox(INDENT_UNIT);
        if (loc.super_ !== undefined) {
          this.s.word_nbsp("super");
        }
        this.s.word_nbsp("let");

        const ib2 = this.s.ibox(INDENT_UNIT);
        this.print_local_decl(loc);
        this.s.end(ib2);
        const init_else = ast.LocalKind.init_else_opt(loc.kind);
        if (init_else !== undefined) {
          const [init, els] = init_else;
          this.s.nbsp();
          this.s.word_space("=");
          this.print_expr_cond_paren(
            init,
            els !== undefined && classify.expr_trailing_brace(init) !== undefined,
            FixupContext.default(),
          );
          if (els !== undefined) {
            const cb = this.s.cbox(INDENT_UNIT);
            const ib = this.s.ibox(INDENT_UNIT);
            this.s.word(" else ");
            this.print_block(els, cb, ib);
          }
        }
        this.s.word(";");
        this.s.end(ib1);
        break;
      }
      case "Item":
        this.print_item(kind._0);
        break;
      case "Expr": {
        const expr = kind._0;
        this.s.space_if_not_bol();
        this.print_expr_outer_attr_style(expr, false, FixupContext.new_stmt());
        if (classify.expr_requires_semi_to_be_stmt(expr)) {
          this.s.word(";");
        }
        break;
      }
      case "Semi": {
        const expr = kind._0;
        this.s.space_if_not_bol();
        this.print_expr_outer_attr_style(expr, false, FixupContext.new_stmt());
        this.s.word(";");
        break;
      }
      case "Empty": {
        this.s.space_if_not_bol();
        this.s.word(";");
        break;
      }
      case "MacCall": {
        const mac = kind._0;
        this.s.space_if_not_bol();
        this.print_outer_attributes(mac.attrs);
        this.print_mac(mac.mac);
        if (mac.style === "Semicolon") {
          this.s.word(";");
        }
        break;
      }
    }
    this.maybe_print_trailing_comment(st.span, undefined);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1580 print_block
  print_block(blk: ast.Block, cb: BoxMarker, ib: BoxMarker): void {
    this.print_block_with_attrs(blk, [], cb, ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1584 print_block_unclosed_indent
  print_block_unclosed_indent(blk: ast.Block, ib: BoxMarker): void {
    this.print_block_maybe_unclosed(blk, [], undefined, ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1588 print_block_with_attrs
  print_block_with_attrs(blk: ast.Block, attrs: readonly ast.Attribute[], cb: BoxMarker, ib: BoxMarker): void {
    this.print_block_maybe_unclosed(blk, attrs, cb, ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1598 print_block_maybe_unclosed
  print_block_maybe_unclosed(
    blk: ast.Block,
    attrs: readonly ast.Attribute[],
    cb: BoxMarker | undefined,
    ib: BoxMarker,
  ): void {
    switch (blk.rules.$) {
      case "Unsafe":
        this.s.word_space("unsafe");
        break;
      case "Default":
        break;
    }
    this.maybe_print_comment(Span.lo(blk.span));
    this.ann.pre(this, { $: "Block", _0: blk });
    this.bopen(ib);

    const has_attrs = this.print_inner_attributes(attrs);

    for (let i = 0; i < blk.stmts.length; i++) {
      const st = blk.stmts[i]!;
      if (st.kind.$ === "Expr" && i === blk.stmts.length - 1) {
        const expr = st.kind._0;
        this.maybe_print_comment(Span.lo(st.span));
        this.s.space_if_not_bol();
        this.print_expr_outer_attr_style(expr, false, FixupContext.new_stmt());
        this.maybe_print_trailing_comment(expr.span, Span.hi(blk.span));
      } else {
        this.print_stmt(st);
      }
    }

    const no_space = !has_attrs && blk.stmts.length === 0;
    this.bclose_maybe_open(blk.span, no_space, cb);
    this.ann.post(this, { $: "Block", _0: blk });
  }

  /// Print a `let pat = expr` expression.
  ///
  /// Parentheses are inserted surrounding `expr` if a round-trip through the
  /// parser would otherwise work out the wrong way in a condition position.
  ///
  /// For example each of the following would mean the wrong thing without
  /// parentheses.
  ///
  /// ```ignore (illustrative)
  /// if let _ = (Struct {}) {}
  ///
  /// if let _ = (true && false) {}
  /// ```
  ///
  /// In a match guard, the second case still requires parens, but the first
  /// case no longer does because anything until `=>` is considered part of
  /// the match guard expression. Parsing of the expression is not terminated
  /// by `{` in that position.
  ///
  /// ```ignore (illustrative)
  /// match () {
  ///     () if let _ = Struct {} => {}
  ///     () if let _ = (true && false) => {}
  /// }
  /// ```
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1657 print_let
  print_let(pat: ast.Pat, expr: ast.Expr, fixup: FixupContext): void {
    this.s.word("let ");
    this.print_pat(pat);
    this.s.space();
    this.s.word_space("=");
    this.print_expr_cond_paren(expr, fixup.needs_par_as_let_scrutinee(expr), FixupContext.default());
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1669 print_mac
  print_mac(m: ast.MacCall): void {
    this.print_mac_common(
      { $: "Path", _0: m.path },
      true,
      undefined,
      m.args.delim,
      undefined,
      m.args.tokens,
      true,
      m.span(),
    );
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1682 inline_asm_template_and_operands
  static inline_asm_template_and_operands(asm: ast.InlineAsm): [string, ast.InlineAsmOperand[]] {
    // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1685 is_explicit_reg
    function is_explicit_reg(op: ast.InlineAsmOperand): boolean {
      switch (op.$) {
        case "In":
        case "Out":
        case "InOut":
        case "SplitInOut":
          return op.reg.$ === "Reg";
        case "Const":
        case "Sym":
        case "Label":
          return false;
      }
    }

    // After macro expansion, named operands become positional. The grammar
    // requires positional operands to precede explicit register operands,
    // so we must reorder when any non-explicit operand follows an explicit
    // one. When no reordering is needed, we use the original template
    // string and operand order to avoid duplicating the Display logic in
    // InlineAsmTemplatePiece.
    let needs_reorder: boolean;
    {
      let seen_explicit = false;
      needs_reorder = asm.operands.some(([op, _]) => {
        if (is_explicit_reg(op)) {
          seen_explicit = true;
          return false;
        } else {
          return seen_explicit;
        }
      });
    }

    if (!needs_reorder) {
      const template = ast.InlineAsmTemplatePiece.to_string(asm.template);
      const operands = asm.operands.map(([op, _]) => op);
      return [template, operands];
    }

    const non_explicit: number[] = [];
    const explicit: number[] = [];
    for (let i = 0; i < asm.operands.length; i++) {
      const [op, _] = asm.operands[i]!;
      if (is_explicit_reg(op)) {
        explicit.push(i);
      } else {
        non_explicit.push(i);
      }
    }
    const order = [...non_explicit, ...explicit];

    // Build old-index -> new-index mapping for template renumbering.
    const old_to_new: number[] = new Array<number>(asm.operands.length).fill(0);
    for (let new_idx = 0; new_idx < order.length; new_idx++) {
      const old_idx = order[new_idx]!;
      old_to_new[old_idx] = new_idx;
    }

    // Remap template placeholder indices and reuse the existing Display
    // impl to build the template string.
    const remapped: ast.InlineAsmTemplatePiece[] = asm.template.map((piece) => {
      if (piece.$ === "Placeholder") {
        return {
          $: "Placeholder",
          operand_idx: old_to_new[piece.operand_idx]!,
          modifier: piece.modifier,
          span: piece.span,
        };
      }
      return ast.clone_InlineAsmTemplatePiece(piece);
    });
    const template = ast.InlineAsmTemplatePiece.to_string(remapped);
    const operands = order.map((idx) => asm.operands[idx]![0]);
    return [template, operands];
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1761 print_inline_asm
  print_inline_asm(asm: ast.InlineAsm): void {
    type AsmArg =
      | { readonly $: "Template"; _0: string }
      | { readonly $: "Operand"; _0: ast.InlineAsmOperand }
      | { readonly $: "ClobberAbi"; _0: Symbol }
      | { readonly $: "Options"; _0: ast.InlineAsmOptions };

    const [template, operands] = State.inline_asm_template_and_operands(asm);
    const args: AsmArg[] = [{ $: "Template", _0: template }];
    for (const op of operands) args.push({ $: "Operand", _0: op });
    for (const [abi, _] of asm.clobber_abis) {
      args.push({ $: "ClobberAbi", _0: abi });
    }
    if (!ast.InlineAsmOptions.is_empty(asm.options)) {
      args.push({ $: "Options", _0: asm.options });
    }

    this.s.popen();
    this.commasep(Consistent, args, (s, arg) => {
      switch (arg.$) {
        case "Template":
          s.print_string(arg._0, ast.StrStyle.Cooked);
          break;
        case "Operand": {
          const op = arg._0;
          const print_reg_or_class = (s: State, r: ast.InlineAsmRegOrRegClass): void => {
            switch (r.$) {
              case "Reg":
                return s.print_symbol(r._0, ast.StrStyle.Cooked);
              case "RegClass":
                return s.s.word(Symbol.as_str(r._0));
            }
          };
          switch (op.$) {
            case "In": {
              const { reg, expr } = op;
              s.s.word("in");
              s.s.popen();
              print_reg_or_class(s, reg);
              s.s.pclose();
              s.s.space();
              s.print_expr(expr, FixupContext.default());
              break;
            }
            case "Out": {
              const { reg, late, expr } = op;
              s.s.word(late ? "lateout" : "out");
              s.s.popen();
              print_reg_or_class(s, reg);
              s.s.pclose();
              s.s.space();
              if (expr !== undefined) {
                s.print_expr(expr, FixupContext.default());
              } else {
                s.s.word("_");
              }
              break;
            }
            case "InOut": {
              const { reg, late, expr } = op;
              s.s.word(late ? "inlateout" : "inout");
              s.s.popen();
              print_reg_or_class(s, reg);
              s.s.pclose();
              s.s.space();
              s.print_expr(expr, FixupContext.default());
              break;
            }
            case "SplitInOut": {
              const { reg, late, in_expr, out_expr } = op;
              s.s.word(late ? "inlateout" : "inout");
              s.s.popen();
              print_reg_or_class(s, reg);
              s.s.pclose();
              s.s.space();
              s.print_expr(in_expr, FixupContext.default());
              s.s.space();
              s.s.word_space("=>");
              if (out_expr !== undefined) {
                s.print_expr(out_expr, FixupContext.default());
              } else {
                s.s.word("_");
              }
              break;
            }
            case "Const": {
              const { anon_const } = op;
              s.s.word("const");
              s.s.space();
              s.print_expr(anon_const.value, FixupContext.default());
              break;
            }
            case "Sym": {
              const { sym } = op;
              s.s.word("sym");
              s.s.space();
              if (sym.qself !== undefined) {
                s.print_qpath(sym.path, sym.qself, true);
              } else {
                s.print_path(sym.path, true, 0);
              }
              break;
            }
            case "Label": {
              const { block } = op;
              const [cb, ib] = s.head("label");
              s.print_block(block, cb, ib);
              break;
            }
          }
          break;
        }
        case "ClobberAbi": {
          const abi = arg._0;
          s.s.word("clobber_abi");
          s.s.popen();
          s.print_symbol(abi, ast.StrStyle.Cooked);
          s.s.pclose();
          break;
        }
        case "Options": {
          const opts = arg._0;
          s.s.word("options");
          s.s.popen();
          s.commasep(Inconsistent, ast.InlineAsmOptions.human_readable_names(opts), (s, opt) => {
            s.s.word(opt);
          });
          s.s.pclose();
          break;
        }
      }
    });
    this.s.pclose();
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1867 print_local_decl
  print_local_decl(loc: ast.Local): void {
    this.print_pat(loc.pat);
    const ty = loc.ty;
    if (ty !== undefined) {
      this.s.word_space(":");
      this.print_type(ty);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1875 print_name
  print_name(name: Symbol): void {
    this.s.word(Symbol.as_str(name));
    this.ann.post(this, { $: "Name", _0: name });
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1880 print_qpath
  print_qpath(path: ast.Path, qself: ast.QSelf, colons_before_params: boolean): void {
    this.s.word("<");
    this.print_type(qself.ty);
    if (qself.position > 0) {
      this.s.space();
      this.s.word_space("as");
      const depth = path.segments.length - qself.position;
      this.print_path(path, false, depth);
    }
    this.s.word(">");
    for (const item_segment of path.segments.slice(qself.position)) {
      this.s.word("::");
      this.print_ident(item_segment.ident);
      const args = item_segment.args;
      if (args !== undefined) {
        this.print_generic_args(args, colons_before_params);
      }
    }
  }

  /// Print a pattern, parenthesizing it if it is an or-pattern (`A | B`).
  ///
  /// Or-patterns have the lowest precedence among patterns, so they need
  /// parentheses when nested inside `@` bindings, `&` references, or `box`
  /// patterns — otherwise `x @ A | B` parses as `(x @ A) | B`, `&A | B`
  /// parses as `(&A) | B`, etc.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1905 print_pat_paren_if_or
  print_pat_paren_if_or(pat: ast.Pat): void {
    const needs_paren = pat.kind.$ === "Or";
    if (needs_paren) {
      this.s.popen();
    }
    this.print_pat(pat);
    if (needs_paren) {
      this.s.pclose();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:1916 print_pat
  print_pat(pat: ast.Pat): void {
    this.maybe_print_comment(Span.lo(pat.span));
    this.ann.pre(this, { $: "Pat", _0: pat });
    /* Pat isn't normalized, but the beauty of it is that it doesn't matter */
    const kind = pat.kind;
    switch (kind.$) {
      case "Missing":
        unreachable();
      // falls through
      case "Wild":
        this.s.word("_");
        break;
      case "Never":
        this.s.word("!");
        break;
      case "Ident": {
        const [by_ref, mutbl] = [kind._0._0, kind._0._1];
        const [ident, sub] = [kind._1, kind._2];
        if (ast.Mutability.is_mut(mutbl)) {
          this.s.word_nbsp("mut");
        }
        if (by_ref.$ === "Yes") {
          const [pinnedness, rmutbl] = [by_ref._0, by_ref._1];
          this.s.word_nbsp("ref");
          if (ast.Pinnedness.is_pinned(pinnedness)) {
            this.s.word_nbsp("pin");
          }
          if (ast.Mutability.is_mut(rmutbl)) {
            this.s.word_nbsp("mut");
          } else if (ast.Pinnedness.is_pinned(pinnedness)) {
            this.s.word_nbsp("const");
          }
        }
        this.print_ident(ident);
        if (sub !== undefined) {
          const p = sub;
          this.s.space();
          this.s.word_space("@");
          this.print_pat_paren_if_or(p);
        }
        break;
      }
      case "TupleStruct": {
        const [qself, path, elts] = [kind._0, kind._1, kind._2];
        if (qself !== undefined) {
          this.print_qpath(path, qself, true);
        } else {
          this.print_path(path, true, 0);
        }
        this.s.popen();
        this.commasep(Inconsistent, elts, (s, p) => s.print_pat(p));
        this.s.pclose();
        break;
      }
      case "Or": {
        const pats = kind._0;
        this.strsep("|", true, Inconsistent, pats, (s, p) => s.print_pat(p));
        break;
      }
      case "Path": {
        const [qself, path] = [kind._0, kind._1];
        if (qself === undefined) {
          this.print_path(path, true, 0);
        } else {
          this.print_qpath(path, qself, false);
        }
        break;
      }
      case "Struct": {
        const [qself, path, fields, etc] = [kind._0, kind._1, kind._2, kind._3];
        if (qself !== undefined) {
          this.print_qpath(path, qself, true);
        } else {
          this.print_path(path, true, 0);
        }
        this.s.nbsp();
        this.s.word("{");
        const empty = fields.length === 0 && etc.$ === "None";
        if (!empty) {
          this.s.space();
        }
        this.commasep_cmnt(
          Consistent,
          fields,
          (s, f) => {
            const cb = s.s.cbox(INDENT_UNIT);
            if (!f.is_shorthand) {
              s.print_ident(f.ident);
              s.s.word_nbsp(":");
            }
            s.print_pat(f.pat);
            s.s.end(cb);
          },
          (f) => f.pat.span,
        );
        if (etc.$ === "Rest" || etc.$ === "Recovered") {
          if (fields.length !== 0) {
            this.s.word_space(",");
          }
          this.s.word("..");
          if (etc.$ === "Recovered") {
            this.s.word("/* recovered parse error */");
          }
        }
        if (!empty) {
          this.s.space();
        }
        this.s.word("}");
        break;
      }
      case "Tuple": {
        const elts = kind._0;
        this.s.popen();
        this.commasep(Inconsistent, elts, (s, p) => s.print_pat(p));
        if (elts.length === 1) {
          this.s.word(",");
        }
        this.s.pclose();
        break;
      }
      case "Deref": {
        const inner = kind._0;
        this.s.word("deref!");
        this.s.popen();
        this.print_pat(inner);
        this.s.pclose();
        break;
      }
      case "Ref": {
        const [inner, pinned, mutbl] = [kind._0, kind._1, kind._2];
        this.s.word("&");
        if (ast.Pinnedness.is_pinned(pinned)) {
          this.s.word("pin ");
          if (ast.Mutability.is_not(mutbl)) {
            this.s.word("const ");
          }
        }
        if (ast.Mutability.is_mut(mutbl)) {
          this.s.word("mut ");
        }
        if (inner.kind.$ === "Ident" && ast.BindingMode_eq(inner.kind._0, ast.BindingMode.MUT)) {
          this.s.popen();
          this.print_pat(inner);
          this.s.pclose();
        } else {
          this.print_pat_paren_if_or(inner);
        }
        break;
      }
      case "Expr":
        this.print_expr(kind._0, FixupContext.default());
        break;
      case "Range": {
        const [begin, end, end_kind] = [kind._0, kind._1, kind._2.node];
        if (begin !== undefined) {
          this.print_expr(begin, FixupContext.default());
        }
        if (end_kind.$ === "Included" && end_kind._0 === "DotDotDot") {
          this.s.word("...");
        } else if (end_kind.$ === "Included" && end_kind._0 === "DotDotEq") {
          this.s.word("..=");
        } else {
          // RangeEnd::Excluded
          this.s.word("..");
        }
        if (end !== undefined) {
          this.print_expr(end, FixupContext.default());
        }
        break;
      }
      case "Guard": {
        const [subpat, guard] = [kind._0, kind._1];
        this.s.popen();
        this.print_pat(subpat);
        this.s.space();
        this.s.word_space("if");
        this.print_expr(guard.cond, FixupContext.default());
        this.s.pclose();
        break;
      }
      case "Slice": {
        const elts = kind._0;
        this.s.word("[");
        this.commasep(Inconsistent, elts, (s, p) => s.print_pat(p));
        this.s.word("]");
        break;
      }
      case "Rest":
        this.s.word("..");
        break;
      case "Paren": {
        const inner = kind._0;
        this.s.popen();
        this.print_pat(inner);
        this.s.pclose();
        break;
      }
      case "MacCall":
        this.print_mac(kind._0);
        break;
      case "Err": {
        this.s.popen();
        this.s.word("/*ERROR*/");
        this.s.pclose();
        break;
      }
    }
    this.ann.post(this, { $: "Pat", _0: pat });
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2081 print_explicit_self
  print_explicit_self(explicit_self: ast.ExplicitSelf): void {
    const node = explicit_self.node;
    switch (node.$) {
      case "Value": {
        const m = node._0;
        this.print_mutability(m, false);
        this.s.word("self");
        break;
      }
      case "Region": {
        const [lt, m] = [node._0, node._1];
        this.s.word("&");
        this.print_opt_lifetime(lt);
        this.print_mutability(m, false);
        this.s.word("self");
        break;
      }
      case "Pinned": {
        const [lt, m] = [node._0, node._1];
        this.s.word("&");
        this.print_opt_lifetime(lt);
        this.s.word("pin ");
        this.print_mutability(m, true);
        this.s.word("self");
        break;
      }
      case "Explicit": {
        const [typ, m] = [node._0, node._1];
        this.print_mutability(m, false);
        this.s.word("self");
        this.s.word_space(":");
        this.print_type(typ);
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2109 print_coroutine_marker
  print_coroutine_marker(coroutine_marker: ast.CoroutineMarker): void {
    switch (coroutine_marker.kind) {
      case "Gen": {
        this.s.word_nbsp("gen");
        break;
      }
      case "Async": {
        this.s.word_nbsp("async");
        break;
      }
      case "AsyncGen": {
        this.s.word_nbsp("async");
        this.s.word_nbsp("gen");
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2124 print_type_bounds
  print_type_bounds(bounds: readonly ast.GenericBound[]): void {
    let first = true;
    for (const bound of bounds) {
      if (first) {
        first = false;
      } else {
        this.s.nbsp();
        this.s.word_space("+");
      }

      switch (bound.$) {
        case "Trait": {
          this.print_poly_trait_ref(bound._0);
          break;
        }
        case "Outlives":
          this.print_lifetime(bound._0);
          break;
        case "Use": {
          const args = bound._0;
          this.s.word("use");
          this.s.word("<");
          this.commasep(Inconsistent, args, (s, arg) => {
            switch (arg.$) {
              case "Arg":
                return s.print_path(arg._0, false, 0);
              case "Lifetime":
                return s.print_lifetime(arg._0);
            }
          });
          this.s.word(">");
          break;
        }
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2152 print_lifetime
  print_lifetime(lifetime: ast.Lifetime): void {
    this.s.word(Symbol.as_str(lifetime.ident.name));
    this.ann_post(lifetime.ident);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2157 print_lifetime_bounds
  print_lifetime_bounds(bounds: ast.GenericBounds): void {
    for (let i = 0; i < bounds.length; i++) {
      const bound = bounds[i]!;
      if (i !== 0) {
        this.s.word(" + ");
      }
      switch (bound.$) {
        case "Outlives":
          this.print_lifetime(bound._0);
          break;
        default: {
          panic("expected a lifetime bound, found a trait bound");
        }
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2171 print_generic_params
  print_generic_params(generic_params: readonly ast.GenericParam[]): void {
    if (generic_params.length === 0) {
      return;
    }

    this.s.word("<");

    this.commasep(Inconsistent, generic_params, (s, param) => {
      s.print_outer_attributes_inline(param.attrs);

      const kind = param.kind;
      switch (kind.$) {
        case "Lifetime": {
          const lt: ast.Lifetime = { id: param.id, ident: param.ident };
          s.print_lifetime(lt);
          if (param.bounds.length !== 0) {
            s.s.word_nbsp(":");
            s.print_lifetime_bounds(param.bounds);
          }
          break;
        }
        case "Type": {
          const default_ = kind.default;
          s.print_ident(param.ident);
          if (param.bounds.length !== 0) {
            s.s.word_nbsp(":");
            s.print_type_bounds(param.bounds);
          }
          if (default_ !== undefined) {
            s.s.space();
            s.s.word_space("=");
            s.print_type(default_);
          }
          break;
        }
        case "Const": {
          const [ty, default_] = [kind.ty, kind.default];
          s.s.word_space("const");
          s.print_ident(param.ident);
          s.s.space();
          s.s.word_space(":");
          s.print_type(ty);
          if (param.bounds.length !== 0) {
            s.s.word_nbsp(":");
            s.print_type_bounds(param.bounds);
          }
          if (default_ !== undefined) {
            s.s.space();
            s.s.word_space("=");
            s.print_expr(default_.value, FixupContext.default());
          }
          break;
        }
      }
    });

    this.s.word(">");
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2224 print_mutability
  print_mutability(mutbl: ast.Mutability, print_const: boolean): void {
    switch (mutbl) {
      case "Mut":
        this.s.word_nbsp("mut");
        break;
      case "Not": {
        if (print_const) {
          this.s.word_nbsp("const");
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2235 print_param
  print_param(input: ast.Param, is_closure: boolean): void {
    const ib = this.s.ibox(INDENT_UNIT);

    this.print_outer_attributes_inline(input.attrs);

    if (input.ty.kind.$ === "Infer" && is_closure) {
      this.print_pat(input.pat);
    } else {
      const eself = input.to_self();
      if (eself !== undefined) {
        this.print_explicit_self(eself);
      } else {
        if (input.pat.kind.$ !== "Missing") {
          this.print_pat(input.pat);
          this.s.word(":");
          this.s.space();
        }
        this.print_type(input.ty);
      }
    }
    this.s.end(ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2258 print_fn_ret_ty
  print_fn_ret_ty(fn_ret_ty: ast.FnRetTy): void {
    if (fn_ret_ty.$ === "Ty") {
      const ty = fn_ret_ty._0;
      this.s.space_if_not_bol();
      const ib = this.s.ibox(INDENT_UNIT);
      this.s.word_space("->");
      this.print_type(ty);
      this.s.end(ib);
      this.maybe_print_comment(Span.lo(ty.span));
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2269 print_ty_fn
  print_ty_fn(
    ext: ast.Extern,
    safety: ast.Safety,
    decl: ast.FnDecl,
    name: Ident | undefined,
    generic_params: readonly ast.GenericParam[],
  ): void {
    const ib = this.s.ibox(INDENT_UNIT);
    this.print_formal_generic_params(generic_params);
    // PORT: `ast::Generics::default()` (`#[derive(Default)]`; `WhereClause` too).
    const generics: ast.Generics = {
      params: [],
      where_clause: new ast.WhereClause(false, [], DUMMY_SP),
      span: DUMMY_SP,
    };
    // `ast::FnHeader { safety, ext, ..ast::FnHeader::default() }`
    const d = ast.FnHeader.default();
    const header = new ast.FnHeader(d.constness, d.coroutine_marker, safety, ext);
    this.print_fn(decl, header, name, generics);
    this.s.end(ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2285 print_fn_header_info
  print_fn_header_info(header: ast.FnHeader): void {
    this.print_constness(header.constness);
    if (header.coroutine_marker !== undefined) {
      this.print_coroutine_marker(header.coroutine_marker);
    }
    this.print_safety(header.safety);

    const ext = header.ext;
    switch (ext.$) {
      case "None":
        break;
      case "Implicit": {
        this.s.word_nbsp("extern");
        break;
      }
      case "Explicit": {
        const abi = ext._0;
        this.s.word_nbsp("extern");
        this.print_token_literal(abi.as_token_lit(), abi.span);
        this.s.nbsp();
        break;
      }
    }

    this.s.word("fn");
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2307 print_safety
  print_safety(s: ast.Safety): void {
    switch (s.$) {
      case "Default":
        break;
      case "Safe":
        this.s.word_nbsp("safe");
        break;
      case "Unsafe":
        this.s.word_nbsp("unsafe");
        break;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2315 print_constness
  print_constness(s: ast.Const): void {
    switch (s.$) {
      case "No":
        break;
      case "Yes":
        this.s.word_nbsp("const");
        break;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2322 print_is_auto
  print_is_auto(s: ast.IsAuto): void {
    switch (s) {
      case "Yes":
        this.s.word_nbsp("auto");
        break;
      case "No":
        break;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2329 print_meta_item_lit
  print_meta_item_lit(lit: ast.MetaItemLit): void {
    this.print_token_literal(lit.as_token_lit(), lit.span);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2333 print_token_literal
  print_token_literal(token_lit: tk.Lit, span: Span): void {
    this.maybe_print_comment(Span.lo(span));
    this.s.word(display_Lit(token_lit));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2338 print_symbol
  print_symbol(sym: Symbol, style: ast.StrStyle): void {
    this.print_string(Symbol.as_str(sym), style);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2342 print_inner_attributes_no_trailing_hardbreak
  print_inner_attributes_no_trailing_hardbreak(attrs: readonly ast.Attribute[]): boolean {
    return this.print_either_attributes(attrs, "Inner", false, false);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2346 print_outer_attributes_inline
  print_outer_attributes_inline(attrs: readonly ast.Attribute[]): boolean {
    return this.print_either_attributes(attrs, "Outer", true, true);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2350 print_attribute
  print_attribute(attr: ast.Attribute): void {
    this.print_attribute_inline(attr, false);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2354 print_meta_list_item
  print_meta_list_item(item: ast.MetaItemInner): void {
    switch (item.$) {
      case "MetaItem":
        return this.print_meta_item(item._0);
      case "Lit":
        return this.print_meta_item_lit(item._0);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2361 print_meta_item
  print_meta_item(item: ast.MetaItem): void {
    const ib = this.s.ibox(INDENT_UNIT);

    switch (item.unsafety.$) {
      case "Unsafe": {
        this.s.word("unsafe");
        this.s.popen();
        break;
      }
      case "Default":
      case "Safe":
        break;
    }

    const kind = item.kind;
    switch (kind.$) {
      case "Word":
        this.print_path(item.path, false, 0);
        break;
      case "NameValue": {
        const value = kind._0;
        this.print_path(item.path, false, 0);
        this.s.space();
        this.s.word_space("=");
        this.print_meta_item_lit(value);
        break;
      }
      case "List": {
        const items = kind._0;
        this.print_path(item.path, false, 0);
        this.s.popen();
        this.commasep(Consistent, items, (s, i) => s.print_meta_list_item(i));
        this.s.pclose();
        break;
      }
    }

    switch (item.unsafety.$) {
      case "Unsafe":
        this.s.pclose();
        break;
      case "Default":
      case "Safe":
        break;
    }

    this.s.end(ib);
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2396 bounds_to_string
  bounds_to_string(bounds: readonly ast.GenericBound[]): string {
    return State.to_string((s) => s.print_type_bounds(bounds));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2400 where_bound_predicate_to_string
  where_bound_predicate_to_string(where_bound_predicate: ast.WhereBoundPredicate): string {
    return State.to_string((s) => s.print_where_bound_predicate(where_bound_predicate));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2407 tt_to_string
  tt_to_string(tt: TokenTree): string {
    return State.to_string((s) => {
      s.print_tt(tt, false);
    });
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2413 path_segment_to_string
  path_segment_to_string(p: ast.PathSegment): string {
    return State.to_string((s) => s.print_path_segment(p, false));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2417 meta_list_item_to_string
  meta_list_item_to_string(li: ast.MetaItemInner): string {
    return State.to_string((s) => s.print_meta_list_item(li));
  }

  // rustc: compiler/rustc_ast_pretty/src/pprust/state.rs:2421 attribute_to_string
  attribute_to_string(attr: ast.Attribute): string {
    return State.to_string((s) => s.print_attribute(attr));
  }
}

// PORT: methods of `impl State` in `state/expr.rs` and `state/item.rs` (a later lane) that this
// file calls. Declared here so the calls type-check; the placeholders below call `unported` until
// expr.ts/item.ts assign the real `State.prototype` methods (they are loaded after this module).
export interface State {
  print_expr_cond_paren(expr: ast.Expr, needs_par: boolean, fixup: FixupContext): void;
  print_expr_anon_const(expr: ast.AnonConst, attrs: readonly ast.Attribute[]): void;
  print_expr(expr: ast.Expr, fixup: FixupContext): void;
  print_expr_outer_attr_style(expr: ast.Expr, is_inline: boolean, fixup: FixupContext): void;
  print_foreign_item(item: ast.ForeignItem): void;
  print_item(item: ast.Item): void;
  print_visibility(vis: ast.Visibility): void;
  print_impl_restriction(impl_restriction: ast.ImplRestriction): void;
  print_mut_restriction(mut_restriction: ast.MutRestriction): void;
  print_assoc_item(item: ast.AssocItem): void;
  print_fn(decl: ast.FnDecl, header: ast.FnHeader, ident: Ident | undefined, generics: ast.Generics): void;
  print_where_bound_predicate(where_bound_predicate: ast.WhereBoundPredicate): void;
  // Not called from state.rs; used by `pprust/tests.rs`.
  print_variant(v: ast.Variant): void;
}

State.prototype.print_expr_cond_paren = function (): void {
  unported("rustc_ast_pretty::pprust::state::expr::print_expr_cond_paren");
};
State.prototype.print_expr_anon_const = function (): void {
  unported("rustc_ast_pretty::pprust::state::expr::print_expr_anon_const");
};
State.prototype.print_expr = function (): void {
  unported("rustc_ast_pretty::pprust::state::expr::print_expr");
};
State.prototype.print_expr_outer_attr_style = function (): void {
  unported("rustc_ast_pretty::pprust::state::expr::print_expr_outer_attr_style");
};
State.prototype.print_foreign_item = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_foreign_item");
};
State.prototype.print_item = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_item");
};
State.prototype.print_visibility = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_visibility");
};
State.prototype.print_impl_restriction = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_impl_restriction");
};
State.prototype.print_mut_restriction = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_mut_restriction");
};
State.prototype.print_assoc_item = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_assoc_item");
};
State.prototype.print_fn = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_fn");
};
State.prototype.print_where_bound_predicate = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_where_bound_predicate");
};
State.prototype.print_variant = function (): void {
  unported("rustc_ast_pretty::pprust::state::item::print_variant");
};
