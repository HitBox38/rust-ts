// Port of compiler/rustc_expand/src/stats.rs (`-Zmacro-stats`).
//
// PORT: `ExtCtxt::macro_stats` is a `Map` keyed by `macro_stats_key(name, kind)` (base.ts), standing for upstream's
// `FxHashMap<(Symbol, MacroKind), MacroStat>`; `entry(..).or_default()` is a get-or-insert of a zeroed `MacroStat`.
import { type MacCall, type Path, DUMMY_NODE_ID, Expr, type Attribute } from "../rustc_ast/lib.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { ExpnKind, type MacroKind } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Symbol, kw, sym } from "../rustc_span/symbol.ts";
import { is_whitespace } from "../std/char.ts";
import { write_stderr } from "../std/io.ts";
import { unreachable } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import { type Annotatable, type ExtCtxt, macro_stats_key } from "./base.ts";
import { type AstFragment, type AstFragmentKind, AstFragmentKind as AstFragmentKind_ } from "./expand.ts";

// #[derive(Default)]
export interface MacroStat {
  /// Number of uses of the macro.
  uses: number;

  /// Number of lines of code (when pretty-printed).
  lines: number;

  /// Number of bytes of code (when pretty-printed).
  bytes: number;
}

// rustc: compiler/rustc_expand/src/stats.rs:24 elems_to_string
export function elems_to_string<T>(elems: readonly T[], f: (elem: T) => string): string {
  let s = "";
  for (let i = 0; i < elems.length; i++) {
    const elem = elems[i]!;
    if (i > 0) {
      s += "\n";
    }
    s += f(elem);
  }
  return s;
}

// rustc: compiler/rustc_expand/src/stats.rs:35 fragment_to_string
function fragment_to_string(fragment: AstFragment): string {
  switch (fragment.$) {
    case "OptExpr":
      if (fragment._0 !== undefined) return pprust.expr_to_string(fragment._0);
      return unreachable();
    case "MethodReceiverExpr":
    case "Expr":
      return pprust.expr_to_string(fragment._0);
    case "Pat":
      return pprust.pat_to_string(fragment._0);
    case "Ty":
      return pprust.ty_to_string(fragment._0);
    case "Stmts":
      return elems_to_string(fragment._0, pprust.stmt_to_string);
    case "Items":
      return elems_to_string(fragment._0, (ast) => pprust.item_to_string(ast));
    case "TraitItems":
    case "ImplItems":
    case "TraitImplItems":
      return elems_to_string(fragment._0, (ast) => pprust.assoc_item_to_string(ast));
    case "ForeignItems":
      return elems_to_string(fragment._0, (ast) => pprust.foreign_item_to_string(ast));
    case "Crate":
    case "Arms":
    case "ExprFields":
    case "PatFields":
    case "GenericParams":
    case "Params":
    case "FieldDefs":
    case "Variants":
    case "WherePredicates":
      return unreachable();
  }
}

// rustc: compiler/rustc_expand/src/stats.rs:65 update_bang_macro_stats
export function update_bang_macro_stats(
  ecx: ExtCtxt,
  fragment_kind: AstFragmentKind,
  span: Span,
  mac: MacCall,
  fragment: AstFragment,
): void {
  // Does this path match any of the include macros, e.g. `include!`?
  // Ignore them. They would have large numbers but are entirely
  // unsurprising and uninteresting.
  const is_include_path =
    mac.path.eq_Symbol(sym.include) ||
    mac.path.eq_Symbol(sym.include_bytes) ||
    mac.path.eq_Symbol(sym.include_str) ||
    mac.path.eq_slice([sym.std, sym.include]) || // std::include
    mac.path.eq_slice([sym.std, sym.include_bytes]) || // std::include_bytes
    mac.path.eq_slice([sym.std, sym.include_str]); // std::include_str
  if (is_include_path) {
    return;
  }

  // The call itself (e.g. `println!("hi")`) is the input. Need to wrap
  // `mac` in something printable; `ast::Expr` is as good as anything
  // else.
  const expr = new Expr(DUMMY_NODE_ID, { $: "MacCall", _0: mac }, DUMMY_SP, [], undefined);
  const input = pprust.expr_to_string(expr);

  // Get `mac` back out of `expr`.
  if (expr.kind.$ !== "MacCall") return unreachable();
  const mac_ = expr.kind._0;

  update_macro_stats(ecx, "Bang", fragment_kind, span, mac_.path, input, fragment);
}

// rustc: compiler/rustc_expand/src/stats.rs:103 update_attr_macro_stats
export function update_attr_macro_stats(
  ecx: ExtCtxt,
  fragment_kind: AstFragmentKind,
  span: Span,
  path: Path,
  attr: Attribute,
  item: Annotatable,
  fragment: AstFragment,
): void {
  // Does this path match `#[derive(...)]` in any of its forms? If so,
  // ignore it because the individual derives will go through the
  // `Invocation::Derive` handling separately.
  const is_derive_path =
    path.eq_Symbol(sym.derive) ||
    // ::core::prelude::v1::derive
    path.eq_slice([kw.PathRoot, sym.core, sym.prelude, sym.v1, sym.derive]);
  if (is_derive_path) {
    return;
  }

  // The attribute plus the item itself constitute the input, which we
  // measure.
  const input = `${pprust.attribute_to_string(attr)}\n${fragment_to_string(AstFragmentKind_.expect_from_annotatables(fragment_kind, [item]))}`;
  update_macro_stats(ecx, "Attr", fragment_kind, span, path, input, fragment);
}

// rustc: compiler/rustc_expand/src/stats.rs:132 update_derive_macro_stats
export function update_derive_macro_stats(
  ecx: ExtCtxt,
  fragment_kind: AstFragmentKind,
  span: Span,
  path: Path,
  fragment: AstFragment,
): void {
  // Use something like `#[derive(Clone)]` for the measured input, even
  // though it may have actually appeared in a multi-derive attribute
  // like `#[derive(Clone, Copy, Debug)]`.
  const input = `#[derive(${pprust.path_to_string(path)})]`;
  update_macro_stats(ecx, "Derive", fragment_kind, span, path, input, fragment);
}

// rustc: compiler/rustc_expand/src/stats.rs:146 update_macro_stats
export function update_macro_stats(
  ecx: ExtCtxt,
  macro_kind: MacroKind,
  fragment_kind: AstFragmentKind,
  span: Span,
  path: Path,
  input: string,
  fragment: AstFragment,
): void {
  // Measure the size of the output by pretty-printing it and counting
  // the lines and bytes.
  const name = Symbol.intern(pprust.path_to_string(path));
  const output = fragment_to_string(fragment);
  const num_lines = trim_end(output).split("\n").length;
  const num_bytes = utf8_len(output);

  // This code is useful for debugging `-Zmacro-stats`. For every
  // invocation it prints the full input and output.
  // PORT: upstream's `if false { .. }`, kept so the body is ported; `DEBUG_MACRO_STATS` is `false`.
  if (DEBUG_MACRO_STATS) {
    const name_ = ExpnKind.descr({ $: "Macro", _0: macro_kind, _1: name });
    const crate_name = Symbol.as_str(ecx.ecfg.crate_name);
    const span_ = ecx.sess.source_map().span_to_diagnostic_string(span);
    write_stderr(
      "-------------------------------\n" +
        `${name_}: [${crate_name}] (${fragment_kind}) ${span_}\n` +
        "-------------------------------\n" +
        `${input}\n` +
        `-- ${num_lines} lines, ${num_bytes} bytes --\n` +
        `${output}\n`,
    );
  }

  // The recorded size is the difference between the input and the output.
  const key = macro_stats_key(name, macro_kind);
  let entry = ecx.macro_stats.get(key);
  if (entry === undefined) {
    entry = { uses: 0, lines: 0, bytes: 0 };
    ecx.macro_stats.set(key, entry);
  }
  entry.uses += 1;
  entry.lines += num_lines;
  entry.bytes += num_bytes;
}

const DEBUG_MACRO_STATS = false as boolean;

/** PORT: `str::trim_end` (trailing `char::is_whitespace`) on a JS string; JS `trimEnd` uses another whitespace set. */
function trim_end(s: string): string {
  let end = s.length;
  while (end > 0) {
    let c = s.charCodeAt(end - 1);
    let w = 1;
    if (c >= 0xdc00 && c <= 0xdfff && end >= 2) {
      const hi = s.charCodeAt(end - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) {
        c = (hi - 0xd800) * 0x400 + (c - 0xdc00) + 0x10000;
        w = 2;
      }
    }
    if (!is_whitespace(c)) break;
    end -= w;
  }
  return s.slice(0, end);
}
