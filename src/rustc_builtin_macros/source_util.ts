// Port of compiler/rustc_builtin_macros/src/source_util.rs
//! The implementation of built-in macros which relate to the file system.

import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, join_path_idents, token } from "../rustc_ast/lib.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import { DummyResult, type ExtCtxt, MacEager, MacResult, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { Applicability } from "../rustc_lint_defs/lib.ts";
import { INCOMPLETE_INCLUDE } from "../rustc_lint_defs/builtin.ts";
import { StripTokens } from "../rustc_parse/lexer/mod.ts";
import { AllowConstBlockItems, ForceCollect } from "../rustc_parse/parser/mod.gen.ts";
import { new_parser_from_file, unwrap_or_emit_fatal, utf8_error } from "../rustc_parse/lib.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { Session } from "../rustc_session/session.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { FileName, RemapPathScopeComponents, Span } from "../rustc_span/lib.ts";
import { ByteSymbol, Symbol } from "../rustc_span/symbol.ts";
import type { NodeId } from "../rustc_ast/lib.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import { escape_char } from "../std/fmt.ts";
import { display_IoError } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { type Component, path_components, path_file_name, path_is_absolute, path_join, path_parent } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { from_utf8 } from "../std/str.ts";
import * as diagnostics from "./diagnostics.ts";
import { check_zero_tts, get_single_str_from_tts, get_single_str_spanned_from_tts, parse_expr } from "./util.ts";

/// Expand `line!()` to the current line number.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:30 expand_line
export function expand_line(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  check_zero_tts(cx, sp, tts, "line!");

  const topmost = cx.expansion_cause() ?? sp;
  const loc = cx.source_map().lookup_char_pos(Span.lo(topmost));

  return { $: "Ready", _0: MacEager.expr(cx.expr_u32(topmost, loc.line)) };
}

/// Expand `column!()` to the current column number.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:45 expand_column
export function expand_column(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  check_zero_tts(cx, sp, tts, "column!");

  const topmost = cx.expansion_cause() ?? sp;
  const loc = cx.source_map().lookup_char_pos(Span.lo(topmost));

  // PORT: `loc.col.to_usize() as u32 + 1`: `CharPos` is a branded number.
  return { $: "Ready", _0: MacEager.expr(cx.expr_u32(topmost, (loc.col as number) + 1)) };
}

/// Expand `file!()` to the current filename.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:60 expand_file
export function expand_file(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  check_zero_tts(cx, sp, tts, "file!");

  const topmost = cx.expansion_cause() ?? sp;
  const loc = cx.source_map().lookup_char_pos(Span.lo(topmost));

  // `use rustc_span::RemapPathScopeComponents;`
  return {
    $: "Ready",
    _0: MacEager.expr(
      cx.expr_str(topmost, Symbol.intern(FileName.display(loc.file.name, RemapPathScopeComponents.MACRO).to_string_lossy())),
    ),
  };
}

/// Expand `stringify!($input)`.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:79 expand_stringify
export function expand_stringify(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  const s = pprust.tts_to_string(tts);
  return { $: "Ready", _0: MacEager.expr(cx.expr_str(sp, Symbol.intern(s))) };
}

/// Expand `module_path!()` to (a textual representation of) the current module path.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:90 expand_mod
export function expand_mod(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  check_zero_tts(cx, sp, tts, "module_path!");
  const mod_path = cx.current_expansion.module.mod_path;
  const string = join_path_idents(mod_path);

  return { $: "Ready", _0: MacEager.expr(cx.expr_str(sp, Symbol.intern(string))) };
}

/// Expand `include!($input)`.
///
/// This works in item and expression position. Notably, it doesn't work in pattern position.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:106 expand_include
export function expand_include(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  const r = get_single_str_from_tts(cx, sp, tts, "include!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const path_ = mac._0;
  // The file will be added to the code map by the parser
  const pr = session_resolve_path(cx.sess, Symbol.as_str(path_), sp);
  if (pr.$ === "Err") {
    const guar = pr._0.emit_err();
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  }
  const path = pr._0;

  // If in the included file we have e.g., `mod bar;`,
  // then the path of `bar.rs` should be relative to the directory of `path`.
  // See https://github.com/rust-lang/rust/pull/69838/files#r395217057 for a discussion.
  // `MacroExpander::fully_expand_fragment` later restores, so "stack discipline" is maintained.
  const dir_path = path_parent(path) ?? path;
  cx.current_expansion.module = cx.current_expansion.module.with_dir_path(dir_path);
  cx.current_expansion.dir_ownership = { $: "Owned", relative: undefined };

  return { $: "Ready", _0: new ExpandInclude(cx.psess(), path, cx.current_expansion.lint_node_id, sp) };
}

// PORT: the fn-local `struct ExpandInclude` + `impl MacResult for ExpandInclude` of `expand_include`,
// hoisted to module level (a subclass of the `MacResult` base class).
class ExpandInclude extends MacResult {
  constructor(
    public psess: ParseSess,
    public path: string,
    public node_id: NodeId,
    public span: Span,
  ) {
    super();
  }

  // rustc: compiler/rustc_builtin_macros/src/source_util.rs:143 make_expr
  override make_expr(): ast.Expr | undefined {
    const p = unwrap_or_emit_fatal(new_parser_from_file(this.psess, this.path, StripTokens.Nothing, this.span));
    const r = parse_expr(p);
    if (r.$ === "Err") return undefined;
    const expr = r._0;
    if (!p.token.eq(token.TokenKind.Eof)) {
      p.psess.buffer_lint(INCOMPLETE_INCLUDE, p.token.span, this.node_id, diagnostics.IncompleteInclude_diagnostic({}));
    }
    return expr;
  }

  // rustc: compiler/rustc_builtin_macros/src/source_util.rs:162 make_items
  override make_items(): ast.Item[] | undefined {
    const p = unwrap_or_emit_fatal(new_parser_from_file(this.psess, this.path, StripTokens.ShebangAndFrontmatter, this.span));
    const ret: ast.Item[] = [];
    for (;;) {
      const r = p.parse_item(ForceCollect.No, AllowConstBlockItems.Yes);
      if (r.$ === "Err") {
        r._0.emit();
        break;
      } else if (r._0 !== undefined) {
        ret.push(r._0);
      } else {
        if (!p.token.eq(token.TokenKind.Eof)) {
          p.dcx().emit_err(diagnostics.ExpectedItem_diagnostic({ span: p.token.span, token: pprust.token_to_string(p.token) }));
        }

        break;
      }
    }
    return ret;
  }
}

/// Expand `include_str!($input)` to the content of the UTF-8-encoded file given by path `$input` as a string literal.
///
/// This works in expression, pattern and statement position.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:204 expand_include_str
export function expand_include_str(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  const r = get_single_str_spanned_from_tts(cx, sp, tts, "include_str!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const [path, path_span] = mac._0;
  const lr = load_binary_file(cx, Symbol.as_str(path), sp, path_span);
  let res: MacResult;
  if (lr.$ === "Ok") {
    const [bytes, bsp] = lr._0;
    const u = from_utf8(bytes);
    if (u.$ === "Ok") {
      const src = u._0;
      const interned_src = Symbol.intern(src);
      // MacEager converts the expr into a pat if need be.
      res = MacEager.expr(cx.expr_str(cx.with_def_site_ctxt(bsp), interned_src));
    } else {
      const utf8err = u._0;
      const err = cx.dcx().struct_span_err(sp, `\`${Symbol.as_str(path)}\` wasn't a utf-8 file`);
      utf8_error(cx.source_map(), Symbol.as_str(path), undefined, err, utf8err, bytes);
      res = DummyResult.any(sp, err.emit_err());
    }
  } else {
    res = lr._0;
  }
  return { $: "Ready", _0: res };
}

/// Expand `include_bytes!($input)` to the content of the file given by path `$input`.
///
/// This works in expression, pattern and statement position.
// rustc: compiler/rustc_builtin_macros/src/source_util.rs:238 expand_include_bytes
export function expand_include_bytes(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);
  const r = get_single_str_spanned_from_tts(cx, sp, tts, "include_bytes!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const [path, path_span] = mac._0;
  const lr = load_binary_file(cx, Symbol.as_str(path), sp, path_span);
  let res: MacResult;
  if (lr.$ === "Ok") {
    const [bytes, _bsp] = lr._0;
    // Don't care about getting the span for the raw bytes,
    // because the console can't really show them anyway.
    const expr = cx.expr(sp, { $: "IncludedBytes", _0: ByteSymbol.intern(bytes) });
    // MacEager converts the expr into a pat if need be.
    res = MacEager.expr(expr);
  } else {
    res = lr._0;
  }
  return { $: "Ready", _0: res };
}

// rustc: compiler/rustc_builtin_macros/src/source_util.rs:264 load_binary_file
function load_binary_file(
  cx: ExtCtxt,
  original_path: string,
  macro_span: Span,
  path_span: Span,
): Result<[Uint8Array, Span], MacResult> {
  const pr = session_resolve_path(cx.sess, original_path, macro_span);
  if (pr.$ === "Err") {
    const guar = pr._0.emit_err();
    return Err(DummyResult.any(macro_span, guar));
  }
  const resolved_path = pr._0;
  const lr = cx.source_map().load_binary_file(resolved_path);
  if (lr.$ === "Ok") {
    const data = lr._0;
    // PORT: `to_string_lossy()`: paths are JS strings already.
    cx.sess.file_depinfo.add(Symbol.intern(resolved_path));

    return Ok(data);
  } else {
    const io_err = lr._0;
    const err = cx.dcx().struct_span_err(macro_span, `couldn't read \`${resolved_path}\`: ${display_IoError(io_err)}`);

    if (!path_is_absolute(original_path)) {
      const source_map = cx.sess.source_map();
      const src = FileName.into_local_path(source_map.span_to_filename(Span.source_callsite(macro_span)));
      let new_path: string | undefined;
      if (src !== undefined) {
        const parent = path_parent(src);
        // `.and_then(|path| path.into_os_string().into_string().ok())`: always valid UTF-8 here.
        new_path = parent === undefined ? undefined : find_path_suggestion(source_map, parent, original_path);
      }

      if (new_path !== undefined) {
        err.span_suggestion_verbose(
          path_span,
          "there is a file with the same name in a different directory",
          `"${str_escape_debug(new_path.replaceAll("\\", "/"))}"`,
          Applicability.MachineApplicable,
        );
      }
    }
    const guar = err.emit_err();
    return Err(DummyResult.any(macro_span, guar));
  }
}

// rustc: compiler/rustc_builtin_macros/src/source_util.rs:315 find_path_suggestion
function find_path_suggestion(source_map: SourceMap, base_dir: string, wanted_path: string): string | undefined {
  // Fix paths that assume they're relative to cargo manifest dir
  const base_c = path_components(base_dir);
  const wanted_c = path_components(wanted_path);
  let without_base: string | undefined = undefined;
  for (let wanted_next = wanted_c.next(); wanted_next !== undefined; wanted_next = wanted_c.next()) {
    if (path_file_name(wanted_c.as_path()) === undefined) {
      break;
    }
    // base_dir may be absolute
    for (let base_next = base_c.next(); base_next !== undefined; base_next = base_c.next()) {
      if (component_eq(base_next, wanted_next)) {
        without_base = wanted_c.as_path();
        break;
      }
    }
  }
  const root_absolute: string[] = without_base === undefined ? [] : [without_base];

  let base_dir_components = 0;
  for (const c = path_components(base_dir); c.next() !== undefined; ) base_dir_components++;
  // Avoid going all the way to the root dir
  const max_parent_components = !path_is_absolute(base_dir) ? base_dir_components + 1 : Math.max(base_dir_components - 1, 0);

  // Try with additional leading ../
  let prefix = "";
  const add: string[] = [];
  for (let i = 0; i < Math.min(max_parent_components, 3); i++) {
    prefix = path_join(prefix, "..");
    add.push(path_join(prefix, wanted_path));
  }

  // Try without leading directories
  // PORT: the lazy `from_fn(..).flatten().flatten().take(4)` iterator is evaluated in order up to the
  // first existing candidate below; collecting it eagerly is equivalent (no side effects).
  let trimmed_path = wanted_path;
  const remove: string[] = [];
  for (;;) {
    if (remove.length >= 4) break;
    const components = path_components(trimmed_path);
    const removed = components.next();
    if (removed === undefined) break;
    trimmed_path = components.as_path();
    if (path_file_name(trimmed_path) === undefined) break; // ensure there is a file name left
    remove.push(trimmed_path);
    if (remove.length >= 4) break;
    if (removed.$ !== "ParentDir") remove.push(path_join("..", trimmed_path));
  }

  for (const new_path of [...root_absolute, ...add, ...remove]) {
    if (source_map.file_exists(path_join(base_dir, new_path))) return new_path;
  }
  return undefined;
}

// ---- local helpers ---------------------------------------------------------------------------------

/** PORT: `Component: PartialEq` (src/std/path.ts keeps `component_eq` private). */
function component_eq(a: Component, b: Component): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Prefix") return a.raw === (b as { raw: string }).raw;
  if (a.$ === "Normal") return a._0 === (b as { _0: string })._0;
  return true;
}

/**
 * PORT: `str::escape_debug` (library/core/src/str/mod.rs:3149) = `char::escape_debug` on every char
 * (src/std/fmt.ts `escape_char(c, true, true)`); same as rustc_ast_pretty's private helper.
 */
function str_escape_debug(s: string): string {
  let out = "";
  for (const c of s) out += escape_char(c.codePointAt(0)!, true, true);
  return out;
}

/** `Session::resolve_path` (rustc_session/src/session.rs:934): not ported in session.ts yet. */
function session_resolve_path(sess: Session, path: string, span: Span): Result<string, Diag> {
  void sess;
  void path;
  void span;
  return unported("rustc_session::Session::resolve_path (session.rs:934)");
}
