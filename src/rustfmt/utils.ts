// Port of src/tools/rustfmt/src/utils.rs (lane rustfmt-contract-2).
//
// The modules this file uses that later lanes port (`comment.rs`) and the external crates of vendor-fmt-small
// (`unicode-width` 0.1, `bytecount`; plan-m8 D7) are imported by their planned paths and declared in contract_lib.d.ts
// until they exist.
//
// PORT: rustfmt's text is a JS `string` (lib.ts's choice). Where upstream measures or indexes a `&str` by bytes
// (`len()`, `rfind`, slicing) the port computes the same UTF-8 byte figure (`utf8_len`) wherever the number leaves the
// function; a UTF-16 index is used only where the slice it cuts is the same (the cut sits next to an ASCII char).
import { ast } from "../rustc_ast/lib.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { is_builtin_attr_name } from "../rustc_feature/lib.ts";
import { LocalExpnId, SyntaxContext } from "../rustc_span/hygiene.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import { type Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { UnicodeWidthStr } from "../vendor/unicode_width_0_1/lib.ts";
import { count as bytecount_count } from "../vendor/bytecount/lib.ts";

import { CharClasses, FullCodeCharKind, LineClasses, filter_normal_code } from "../rustfmt/comment.ts";
import { type Config, StyleEdition } from "./config/mod.ts";
import type { RewriteContext } from "./rewrite.ts";
import { Indent, type Shape } from "./shape.ts";
import { is_whitespace } from "../std/char.ts";
import { panic } from "../std/panic.ts";
import { str_lines, string_trim, string_trim_end, utf8, utf8_len } from "../std/str.ts";

/** `usize::saturating_sub` */
function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:19 depr_skip_annotation
export function depr_skip_annotation(): Symbol {
  return Symbol.intern("rustfmt_skip");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:24 skip_annotation
export function skip_annotation(): Symbol {
  return Symbol.intern("rustfmt::skip");
}

// rustc: src/tools/rustfmt/src/utils.rs:28 rewrite_ident
export function rewrite_ident(context: RewriteContext, ident: Ident): string {
  return context.snippet(ident.span);
}

// Computes the length of a string's last line, minus offset.
// rustc: src/tools/rustfmt/src/utils.rs:33 extra_offset
export function extra_offset(text: string, shape: Shape): number {
  const idx = text.lastIndexOf("\n");
  if (idx >= 0) {
    // 1 for newline character
    // PORT: `idx` is the byte offset of the `'\n'`.
    return saturating_sub(utf8_len(text), utf8_len(text.slice(0, idx)) + 1 + shape.used_width());
  } else {
    return utf8_len(text);
  }
}

// rustc: src/tools/rustfmt/src/utils.rs:41 is_same_visibility
export function is_same_visibility(a: ast.Visibility, b: ast.Visibility): boolean {
  const [ak, bk] = [a.kind, b.kind];
  if (ak.$ === "Restricted" && bk.$ === "Restricted") {
    return pprust.path_to_string(ak.path) === pprust.path_to_string(bk.path);
  } else if ((ak.$ === "Public" && bk.$ === "Public") || (ak.$ === "Inherited" && bk.$ === "Inherited")) {
    return true;
  } else {
    return false;
  }
}

// Uses Cow to avoid allocating in the common cases.
// rustc: src/tools/rustfmt/src/utils.rs:54 format_visibility
export function format_visibility(context: RewriteContext, vis: ast.Visibility): string {
  const kind = vis.kind;
  switch (kind.$) {
    case "Public":
      return "pub ";
    case "Inherited":
      return "";
    case "Restricted": {
      const path = kind.path;
      const { segments } = path;
      // PORT: the lazy `segments.iter().map(|seg| rewrite_ident(..))`: `next()` maps the first segment too.
      let start = 0;
      if (path.is_global()) {
        if (segments.length === 0) panic("Non-global path in pub(restricted)?");
        rewrite_ident(context, segments[0]!.ident);
        start = 1;
      }
      const is_keyword = (s: string) => s === "crate" || s === "self" || s === "super";
      const parts: string[] = [];
      for (let i = start; i < segments.length; i++) parts.push(rewrite_ident(context, segments[i]!.ident));
      const path_ = parts.join("::");
      const in_str = is_keyword(path_) ? "" : "in ";

      return `pub(${in_str}${path_}) `;
    }
  }
}

// rustc: src/tools/rustfmt/src/utils.rs:78 format_impl_restriction
export function format_impl_restriction(context: RewriteContext, impl_restriction: ast.ImplRestriction): string {
  return format_restriction("impl", context, impl_restriction.kind);
}

// rustc: src/tools/rustfmt/src/utils.rs:85 format_mut_restriction
export function format_mut_restriction(context: RewriteContext, mut_restriction: ast.MutRestriction): string {
  return format_restriction("mut", context, mut_restriction.kind);
}

// rustc: src/tools/rustfmt/src/utils.rs:92 format_restriction
function format_restriction(kw: string, context: RewriteContext, restriction: ast.RestrictionKind): string {
  switch (restriction.$) {
    case "Unrestricted":
      return "";
    case "Restricted": {
      const { path, shorthand } = restriction;
      const { segments } = path;
      // PORT: the lazy `segments.iter().map(|seg| rewrite_ident(..))`: `next()` maps the first segment too.
      let start = 0;
      if (path.is_global()) {
        if (segments.length === 0) {
          panic(`non-global path in ${kw}(restricted)?`);
        }
        rewrite_ident(context, segments[0]!.ident);
        start = 1;
      }
      // FIXME use `segments_iter.intersperse("::").collect::<String>()` once
      // `#![feature(iter_intersperse)]` is re-stabilized.
      // PORT: `itertools::join(segments_iter, "::")` (plan-m8 D7: itertools adaptors inline).
      const parts: string[] = [];
      for (let i = start; i < segments.length; i++) parts.push(rewrite_ident(context, segments[i]!.ident));
      const path_ = parts.join("::");
      const in_str = shorthand ? "" : "in ";

      return `${kw}(${in_str}${path_}) `;
    }
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:120 format_coro
export function format_coro(coroutine_marker: ast.CoroutineMarker): string {
  switch (coroutine_marker.kind) {
    case "Async":
      return "async ";
    case "Gen":
      return "gen ";
    case "AsyncGen":
      return "async gen ";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:129 format_constness
export function format_constness(constness: ast.Const): string {
  switch (constness.$) {
    case "Yes":
      return "const ";
    case "No":
      return "";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:137 format_defaultness
export function format_defaultness(defaultness: ast.Defaultness): string {
  switch (defaultness.$) {
    case "Implicit":
      return "";
    case "Default":
      return "default ";
    case "Final":
      return "final ";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:146 format_safety
export function format_safety(unsafety: ast.Safety): string {
  switch (unsafety.$) {
    case "Unsafe":
      return "unsafe ";
    case "Safe":
      return "safe ";
    case "Default":
      return "";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:155 format_auto
export function format_auto(is_auto: ast.IsAuto): string {
  switch (is_auto) {
    case "Yes":
      return "auto ";
    case "No":
      return "";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:163 format_mutability
export function format_mutability(mutability: ast.Mutability): string {
  switch (mutability) {
    case "Mut":
      return "mut ";
    case "Not":
      return "";
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:171 format_pinnedness_and_mutability
export function format_pinnedness_and_mutability(pinnedness: ast.Pinnedness, mutability: ast.Mutability): [string, string] {
  if (pinnedness === "Pinned" && mutability === "Mut") return ["pin ", "mut "];
  else if (pinnedness === "Pinned" && mutability === "Not") return ["pin ", "const "];
  else if (pinnedness === "Not" && mutability === "Mut") return ["", "mut "];
  else return ["", ""]; // (ast::Pinnedness::Not, ast::Mutability::Not)
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:184 format_range_end
export function format_range_end(end: ast.RangeEnd): string {
  if (end.$ === "Included" && end._0 === "DotDotDot") return "...";
  else if (end.$ === "Included" && end._0 === "DotDotEq") return "..=";
  else return ".."; // ast::RangeEnd::Excluded
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:193 format_extern
export function format_extern(ext: ast.Extern, explicit_abi: boolean): string {
  switch (ext.$) {
    case "None":
      return "";
    case "Implicit":
      if (explicit_abi) return 'extern "C" ';
      return "extern ";
    case "Explicit": {
      const abi = ext._0;
      // turn `extern "C"` into `extern` when `explicit_abi` is set to false
      if (abi.symbol_unescaped === sym.C && !explicit_abi) {
        return "extern ";
      }
      return `extern "${Symbol.as_str(abi.symbol_unescaped)}" `;
    }
  }
}

// #[inline]
// Transform `Vec<Box<T>>` into `Vec<&T>`
// rustc: src/tools/rustfmt/src/utils.rs:210 ptr_vec_to_ref_vec
export function ptr_vec_to_ref_vec<T>(vec: readonly T[]): T[] {
  // PORT: `Box<T>` and `&T` are both `T` (PORTING §5): a new vector of the same elements.
  return vec.map((x) => x);
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:215 filter_attributes
export function filter_attributes(attrs: readonly ast.Attribute[], style: ast.AttrStyle): ast.Attribute[] {
  return attrs.filter((a) => a.style === style).map(ast.clone_Attribute);
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:227 inner_attributes
export function inner_attributes(attrs: readonly ast.Attribute[]): ast.Attribute[] {
  return filter_attributes(attrs, "Inner");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:232 outer_attributes
export function outer_attributes(attrs: readonly ast.Attribute[]): ast.Attribute[] {
  return filter_attributes(attrs, "Outer");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:237 is_single_line
export function is_single_line(s: string): boolean {
  return !s.includes("\n");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:242 first_line_contains_single_line_comment
export function first_line_contains_single_line_comment(s: string): boolean {
  const l = str_lines(s)[0];
  return l === undefined ? false : l.includes("//");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:247 last_line_contains_single_line_comment
export function last_line_contains_single_line_comment(s: string): boolean {
  const lines = str_lines(s);
  const l = lines[lines.length - 1];
  return l === undefined ? false : l.includes("//");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:252 is_attributes_extendable
export function is_attributes_extendable(attrs_str: string): boolean {
  return !attrs_str.includes("\n") && !last_line_contains_single_line_comment(attrs_str);
}

/// The width of the first line in s.
// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:258 first_line_width
export function first_line_width(s: string): number {
  // `s.splitn(2, '\n').next().unwrap_or("")`
  const nl = s.indexOf("\n");
  return unicode_str_width(nl < 0 ? s : s.slice(0, nl));
}

/// The width of the last line in s.
// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:264 last_line_width
export function last_line_width(s: string, tab_spaces: number): number {
  // `s.rsplitn(2, '\n').next().unwrap_or("")`
  const last_line = s.slice(s.lastIndexOf("\n") + 1);
  const [prefix_width, prefix_end] = get_prefix_space_width_and_end(last_line, tab_spaces);
  // PORT: `prefix_end` is a byte offset past a run of `' '`/`'\t'` only, so it is also the UTF-16 index.
  return prefix_width + unicode_str_width(last_line.slice(prefix_end));
}

/// The total used width of the last line.
// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:272 last_line_used_width
export function last_line_used_width(s: string, offset: number, tab_spaces: number): number {
  if (s.includes("\n")) {
    return last_line_width(s, tab_spaces);
  } else {
    return offset + unicode_str_width(s);
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:281 trimmed_last_line_width
export function trimmed_last_line_width(s: string): number {
  const n = s.lastIndexOf("\n");
  return unicode_str_width(n >= 0 ? string_trim(s.slice(n + 1)) : string_trim(s));
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:289 last_line_extendable
export function last_line_extendable(s: string): boolean {
  if (s.endsWith('"#')) {
    return true;
  }
  // `for c in s.chars().rev()`
  // PORT: over UTF-16 code units: a char outside the BMP is neither listed nor whitespace, and neither is either of its
  // surrogates, so both take the `_ => return false` arm.
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x28: // '('
      case 0x29: // ')'
      case 0x5d: // ']'
      case 0x7d: // '}'
      case 0x3f: // '?'
      case 0x3e: // '>'
        continue;
      case 0x0a: // '\n'
        return true; // `break` out of the loop, then `true`
      default:
        if (is_whitespace(c)) continue;
        return false;
    }
  }
  return true;
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:305 is_skip
function is_skip(meta_item: ast.MetaItem): boolean {
  const kind = meta_item.kind;
  switch (kind.$) {
    case "Word": {
      const path_str = pprust.path_to_string(meta_item.path);
      return path_str === Symbol.as_str(skip_annotation()) || path_str === Symbol.as_str(depr_skip_annotation());
    }
    case "List": {
      const l = kind._0;
      return meta_item.has_name(sym.cfg_attr) && l.length === 2 && is_skip_nested(l[1]!);
    }
    default:
      return false;
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:319 is_skip_nested
function is_skip_nested(meta_item: ast.MetaItemInner): boolean {
  switch (meta_item.$) {
    case "MetaItem":
      return is_skip(meta_item._0);
    case "Lit":
      return false;
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:327 contains_skip
export function contains_skip(attrs: readonly ast.Attribute[]): boolean {
  return attrs.some((a) => {
    const m = a.meta();
    return m === undefined ? false : is_skip(m);
  });
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:334 contains_custom_attributes
export function contains_custom_attributes(attrs: readonly ast.Attribute[]): boolean {
  return attrs.some((a) => {
    const name = a.name();
    return name !== undefined && !is_builtin_attr_name(name);
  });
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:341 semicolon_for_expr
export function semicolon_for_expr(context: RewriteContext, expr: ast.Expr): boolean {
  // Never try to insert semicolons on expressions when we're inside
  // a macro definition - this can prevent the macro from compiling
  // when used in expression position
  if (context.is_macro_def) {
    return false;
  }

  switch (expr.kind.$) {
    case "Ret":
    case "Continue":
    case "Break":
      return context.config.trailing_semicolon();
    default:
      return false;
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:358 semicolon_for_stmt
export function semicolon_for_stmt(context: RewriteContext, stmt: ast.Stmt, is_last_expr: boolean): boolean {
  const kind = stmt.kind;
  switch (kind.$) {
    case "Semi":
      switch (kind._0.kind.$) {
        case "While":
        case "Loop":
        case "ForLoop":
          return false;
        case "Break":
        case "Continue":
        case "Ret":
          // The only time we can skip the semi-colon is if the config option is set to false
          // **and** this is the last expr (even though any following exprs are unreachable)
          return context.config.trailing_semicolon() || !is_last_expr;
        default:
          return true;
      }
    case "Expr":
      return false;
    default:
      return true;
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:381 stmt_expr
export function stmt_expr(stmt: ast.Stmt): ast.Expr | undefined {
  const kind = stmt.kind;
  switch (kind.$) {
    case "Expr":
      return kind._0;
    default:
      return undefined;
  }
}

/// Returns the number of LF and CRLF respectively.
// rustc: src/tools/rustfmt/src/utils.rs:389 count_lf_crlf
export function count_lf_crlf(input: string): [number, number] {
  let lf = 0;
  let crlf = 0;
  let is_crlf = false;
  // PORT: over UTF-16 code units instead of bytes: a non-ASCII char's bytes and code units all take the `_` arm.
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c === 0x0d) is_crlf = true;
    else if (c === 0x0a && is_crlf) crlf += 1;
    else if (c === 0x0a) lf += 1;
    else is_crlf = false;
  }
  return [lf, crlf];
}

// rustc: src/tools/rustfmt/src/utils.rs:404 count_newlines
export function count_newlines(input: string): number {
  // Using bytes to omit UTF-8 decoding
  return bytecount_count(utf8(input), 0x0a);
}

// For format_missing and last_pos, need to use the source callsite (if applicable).
// Required as generated code spans aren't guaranteed to follow on from the last span.
// PORT: `macro_rules! source { ($this:ident, $sp:expr) => { $sp.source_callsite() } }` as a function; `$this` is unused.
export function source(_this: unknown, sp: Span): Span {
  return Span.source_callsite(sp);
}

// rustc: src/tools/rustfmt/src/utils.rs:417 mk_sp
export function mk_sp(lo: BytePos, hi: BytePos): Span {
  return Span.new(lo, hi, SyntaxContext.root(), undefined);
}

// rustc: src/tools/rustfmt/src/utils.rs:421 mk_sp_lo_plus_one
export function mk_sp_lo_plus_one(lo: BytePos): Span {
  return Span.new(lo, BytePos.add(lo, BytePos(1)), SyntaxContext.root(), undefined);
}

// Returns `true` if the given span does not intersect with file lines.
// PORT: `macro_rules! out_of_file_lines_range` as a function over the `$self` it reads (`config`, `psess`).
export function out_of_file_lines_range(self: Pick<RewriteContext, "config" | "psess">, span: Span): boolean {
  return !self.config.file_lines().is_all() && !self.config.file_lines().intersects(self.psess.lookup_line_range(span));
}

// PORT: `skip_out_of_file_lines_range_err!($self, $span)` and `skip_out_of_file_lines_range_visitor!($self, $span)`
// return from their caller, so each use is written out where it is used:
//   `if (out_of_file_lines_range(self, span)) return Err(RewriteError.SkipFormatting);`
//   `if (out_of_file_lines_range(self, span)) { self.push_rewrite(span, undefined); return; }`

// Wraps String in an Option. Returns Some when the string adheres to the
// Rewrite constraints defined for the Rewrite trait and None otherwise.
// rustc: src/tools/rustfmt/src/utils.rs:455 wrap_str
export function wrap_str(s: string, max_width: number, tab_spaces: number, shape: Shape): string | undefined {
  if (filtered_str_fits(s, max_width, tab_spaces, shape)) {
    return s;
  } else {
    return undefined;
  }
}

// rustc: src/tools/rustfmt/src/utils.rs:468 filtered_str_fits
export function filtered_str_fits(snippet_: string, max_width: number, tab_spaces: number, shape: Shape): boolean {
  const snippet = filter_normal_code(snippet_);
  if (snippet.length !== 0) {
    // First line must fits with `shape.width`.
    if (first_line_width(snippet) > shape.width) {
      return false;
    }
    // If the snippet does not include newline, we are done.
    if (is_single_line(snippet)) {
      return true;
    }
    // The other lines must fit within the maximum width.
    if (
      str_lines(snippet)
        .slice(1)
        .some((line) => unicode_str_width(line) > max_width)
    ) {
      return false;
    }
    // A special check for the last line, since the caller may
    // place trailing characters on this line.
    if (last_line_width(snippet, tab_spaces) > shape.used_width() + shape.width) {
      return false;
    }
  }
  return true;
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:502 colon_spaces
export function colon_spaces(config: Config): string {
  const before = config.space_before_colon();
  const after = config.space_after_colon();
  if (before && after) return " : ";
  else if (before && !after) return " :";
  else if (!before && after) return ": ";
  else return ":";
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:514 left_most_sub_expr
export function left_most_sub_expr(e: ast.Expr): ast.Expr {
  const kind = e.kind;
  switch (kind.$) {
    case "Call":
    case "Cast":
    case "Type":
    case "Assign":
    case "Field":
    case "Index":
    case "Try":
      return left_most_sub_expr(kind._0);
    case "Binary":
    case "AssignOp":
      return left_most_sub_expr(kind._1);
    case "Range":
      if (kind._0 !== undefined) return left_most_sub_expr(kind._0);
      return e;
    default:
      return e;
  }
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:531 starts_with_newline
export function starts_with_newline(s: string): boolean {
  return s.startsWith("\n") || s.startsWith("\r\n");
}

// #[inline]
// rustc: src/tools/rustfmt/src/utils.rs:536 first_line_ends_with
export function first_line_ends_with(s: string, c: number): boolean {
  const l = str_lines(s)[0];
  return l === undefined ? false : l.endsWith(String.fromCodePoint(c));
}

// States whether an expression's last line exclusively consists of closing
// parens, braces, and brackets in its idiomatic formatting.
// rustc: src/tools/rustfmt/src/utils.rs:542 is_block_expr
export function is_block_expr(context: RewriteContext, expr: ast.Expr, repr: string): boolean {
  const kind = expr.kind;
  switch (kind.$) {
    case "MacCall":
    case "FormatArgs":
    case "Call":
    case "MethodCall":
    case "Array":
    case "Struct":
    case "While":
    case "If":
    case "Block":
    case "ConstBlock":
    case "Gen":
    case "Loop":
    case "ForLoop":
    case "TryBlock":
    case "Match":
      return repr.includes("\n");
    case "Paren":
      return is_block_expr(context, kind._0, repr);
    case "Binary":
      return is_block_expr(context, kind._2, repr);
    case "Index":
      return is_block_expr(context, kind._1, repr);
    case "Unary":
      return is_block_expr(context, kind._1, repr);
    case "Try":
      return is_block_expr(context, kind._0, repr);
    case "Yield":
      if (kind._0.$ === "Prefix" && kind._0._0 !== undefined) return is_block_expr(context, kind._0._0, repr);
      return false; // `ast::ExprKind::Yield(..)`, below
    case "GcaMacro":
      return is_block_expr(context, kind._0, repr);
    case "Closure":
      return is_block_expr(context, kind._0.body, repr);
    // This can only be a string lit
    case "Lit":
      return repr.includes("\n") && trimmed_last_line_width(repr) <= context.config.tab_spaces();
    case "AddrOf":
    case "Assign":
    case "AssignOp":
    case "Await":
    case "Break":
    case "Cast":
    case "Continue":
    case "Dummy":
    case "Err":
    case "Field":
    case "IncludedBytes":
    case "InlineAsm":
    case "Move":
    case "OffsetOf":
    case "UnsafeBinderCast":
    case "Let":
    case "Path":
    case "Range":
    case "Repeat":
    case "Ret":
    case "Become":
    case "Yeet":
    case "Tup":
    case "Use":
    case "Type":
    case "Underscore":
      return false;
  }
}

/// Removes trailing spaces from the specified snippet. We do not remove spaces
/// inside strings or comments.
// rustc: src/tools/rustfmt/src/utils.rs:603 remove_trailing_white_spaces
export function remove_trailing_white_spaces(text: string): string {
  let buffer = "";
  let space_buffer = "";
  for (const [char_kind, c] of CharClasses.new(string_chars(text))) {
    if (c === 0x0a) {
      // '\n'
      if (char_kind === "InString") {
        buffer += space_buffer;
      }
      space_buffer = "";
      buffer += "\n";
    } else if (is_whitespace(c)) {
      space_buffer += String.fromCodePoint(c);
    } else {
      if (space_buffer.length !== 0) {
        buffer += space_buffer;
        space_buffer = "";
      }
      buffer += String.fromCodePoint(c);
    }
  }
  return buffer;
}

/** `s.chars()`: the chars (Unicode scalar values) of a JS string. */
function* string_chars(s: string): Generator<number, void, undefined> {
  for (let i = 0; i < s.length; ) {
    const c = s.codePointAt(i)!;
    i += c > 0xffff ? 2 : 1;
    yield c;
  }
}

/// Indent each line according to the specified `indent`.
/// e.g.
///
/// ```rust,compile_fail
/// foo!{
/// x,
/// y,
/// foo(
///     a,
///     b,
///     c,
/// ),
/// }
/// ```
///
/// will become
///
/// ```rust,compile_fail
/// foo!{
///     x,
///     y,
///     foo(
///         a,
///         b,
///         c,
///     ),
/// }
/// ```
// rustc: src/tools/rustfmt/src/utils.rs:658 trim_left_preserve_layout
export function trim_left_preserve_layout(orig: string, indent: Indent, config: Config): string | undefined {
  const lines = LineClasses.new(orig)[globalThis.Symbol.iterator]();
  const first = lines.next();
  if (first.done) return undefined;
  const first_line = string_trim_end(first.value[1]);
  const trimmed_lines: [boolean, string, number | undefined][] = [];

  let veto_trim = false;
  // `lines.filter_map(..).min()?`
  let min_prefix_space_width: number | undefined = undefined;
  for (let next = lines.next(); !next.done; next = lines.next()) {
    const [kind, line_] = next.value;
    let line = line_;
    let trimmed = true;
    let prefix_space_width: number | undefined;
    if (is_empty_line(line)) {
      prefix_space_width = undefined;
    } else {
      const [prefix_width] = get_prefix_space_width_and_end(line, config.tab_spaces());
      prefix_space_width = prefix_width;
    }

    // just InString{Commented} in order to allow the start of a string to be indented
    const new_veto_trim_value =
      (kind === "InString" || (StyleEdition.ge(config.style_edition(), "Edition2024") && kind === "InStringCommented")) &&
      !line.endsWith("\\");
    if (veto_trim || new_veto_trim_value) {
      veto_trim = new_veto_trim_value;
      trimmed = false;
    } else {
      line = string_trim(line);
    }
    trimmed_lines.push([trimmed, line, prefix_space_width]);

    // Because there is a veto against trimming and indenting lines within a string,
    // such lines should not be taken into account when computing the minimum.
    let mapped: number | undefined;
    if ((kind === "InStringCommented" || kind === "EndStringCommented") && StyleEdition.ge(config.style_edition(), "Edition2024")) {
      mapped = undefined;
    } else if (kind === "InString" || kind === "EndString") {
      mapped = undefined;
    } else {
      mapped = prefix_space_width;
    }
    if (mapped !== undefined && (min_prefix_space_width === undefined || mapped < min_prefix_space_width)) {
      min_prefix_space_width = mapped;
    }
  }
  if (min_prefix_space_width === undefined) return undefined;
  const min = min_prefix_space_width;

  return (
    first_line +
    "\n" +
    trimmed_lines
      .map(([trimmed, line, prefix_space_width]) => {
        if (!trimmed) return line;
        if (prefix_space_width !== undefined) {
          const original_indent_width = prefix_space_width;
          const new_indent_width = indent.width() + saturating_sub(original_indent_width, min);
          const new_indent = Indent.from_width(config, new_indent_width);
          return `${new_indent.to_string(config)}${line}`;
        }
        return "";
      })
      .join("\n")
  );
}

/// Based on the given line, determine if the next line can be indented or not.
/// This allows to preserve the indentation of multi-line literals when
/// re-inserted a code block that has been formatted separately from the rest
/// of the code, such as code in macro defs or code blocks doc comments.
// rustc: src/tools/rustfmt/src/utils.rs:732 indent_next_line
export function indent_next_line(kind: FullCodeCharKind, line: string, config: Config): boolean {
  if (FullCodeCharKind.is_string(kind)) {
    // If the string ends with '\', the string has been wrapped over
    // multiple lines. If `format_strings = true`, then the indentation of
    // strings wrapped over multiple lines will have been adjusted while
    // formatting the code block, therefore the string's indentation needs
    // to be adjusted for the code surrounding the code block.
    return config.format_strings() && line.endsWith("\\");
  } else if (StyleEdition.ge(config.style_edition(), "Edition2024")) {
    return !FullCodeCharKind.is_commented_string(kind);
  } else {
    return true;
  }
}

// rustc: src/tools/rustfmt/src/utils.rs:747 is_empty_line
export function is_empty_line(s: string): boolean {
  // PORT: every `White_Space` char is in the BMP, so testing UTF-16 code units gives the same answer.
  if (s.length === 0) return true;
  for (let i = 0; i < s.length; i++) if (!is_whitespace(s.charCodeAt(i))) return false;
  return true;
}

// rustc: src/tools/rustfmt/src/utils.rs:751 get_prefix_space_width_and_end
function get_prefix_space_width_and_end(s: string, tab_spaces: number): [number, number] {
  let width = 0;

  // PORT: `char_indices`: until the first char that is not `' '`/`'\t'` every char is one byte, so `i` is the byte
  // offset; the end of the string is `s.len()` in bytes.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x20) width += 1;
    else if (c === 0x09) width += tab_spaces;
    else return [width, i];
  }
  return [width, utf8_len(s)];
}

// PORT: `trait NodeIdExt { fn root() -> Self; }` has one impl (`NodeId`); a static trait fn is a function on the impl's
// companion, `NodeIdExt_NodeId.root()` for `NodeId::root()`.
export interface NodeIdExt<Self> {
  // rustc: src/tools/rustfmt/src/utils.rs:765 root
  root(): Self;
}

// impl NodeIdExt for NodeId
export const NodeIdExt_NodeId: NodeIdExt<ast.NodeId> = {
  // rustc: src/tools/rustfmt/src/utils.rs:769 root
  root(): ast.NodeId {
    return ast.NodeId.placeholder_from_expn_id(LocalExpnId.ROOT);
  },
};

// rustc: src/tools/rustfmt/src/utils.rs:774 unicode_str_width
export function unicode_str_width(s: string): number {
  return UnicodeWidthStr.width(s);
}
