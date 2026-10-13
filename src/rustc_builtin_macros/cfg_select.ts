// Port of compiler/rustc_builtin_macros/src/cfg_select.rs
import type { AttrIdGenerator } from "../rustc_ast/attr/mod.gen.ts";
import { CfgEntry, clone_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast } from "../rustc_ast/lib.ts";
import { eval_config_entry } from "../rustc_attr_parsing/lib.ts";
import { type CfgSelectBranches, parse_cfg_select } from "../rustc_attr_parsing/attributes/cfg_select.ts";
import { DummyResult, ExpandResult, type ExtCtxt, MacResult, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { DeclaredIdents } from "../rustc_expand/expand.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Ident, sym } from "../rustc_span/symbol.ts";
import { unreachable } from "../std/panic.ts";
import { CfgSelectNoMatches_diagnostic } from "./diagnostics.ts";

/// This intermediate structure is used to emit parse errors for the branches that are not chosen.
/// The `MacResult` instance below parses all branches, emitting any errors it encounters, but only
/// keeps the parse result for the selected branch.
// PORT: `impl MacResult for CfgSelectResult` -> a subclass of the `MacResult` base class (its provided
// methods); the `forward_to_parser_any_macro!` arms are expanded below (one method each, in the
// upstream invocation order).
class CfgSelectResult extends MacResult {
  constructor(
    public ecx: ExtCtxt,
    public site_span: Span,
    public selected_tts: TokenStream,
    public selected_span: Span,
    public other_branches: CfgSelectBranches,
    public cfg_entry: CfgEntry,
  ) {
    super();
  }

  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:76 forward_to_parser_any_macro!(make_expr, Box<Expr>)
  override make_expr(): ast.Expr | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_expr(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:77 forward_to_parser_any_macro!(make_stmts, ..)
  override make_stmts(): ast.Stmt[] | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_stmts(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:78 forward_to_parser_any_macro!(make_items, ..)
  override make_items(): ast.Item[] | undefined {
    return forward_to_parser_any_macro(
      this,
      (r) => r.make_items(),
      (ecx: ExtCtxt, cfg_entry: CfgEntry, _span: Span, items: ast.Item[] | undefined) => {
        if (items !== undefined) {
          // Register item names that were not selected for error reporting. We do this
          // for `#[cfg]` too.
          for (const item of items) {
            for (const name of DeclaredIdents.Item.declared_idents(item)) {
              ecx.resolver.append_stripped_cfg_item(
                ecx.current_expansion.lint_node_id,
                name,
                clone_CfgEntry(cfg_entry),
                CfgEntry.span(cfg_entry),
              );
            }
          }
        }
      },
      (ecx: ExtCtxt, cfg_entry: CfgEntry, items: ast.Item[]) =>
        items.map((item) => {
          item.attrs.push(mk_attr(ecx.sess.psess.attr_id_generator, clone_CfgEntry(cfg_entry)));
          return item;
        }),
    );
  }

  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:109 forward_to_parser_any_macro!(make_impl_items, ..)
  override make_impl_items(): ast.AssocItem[] | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_impl_items(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:110 forward_to_parser_any_macro!(make_trait_impl_items, ..)
  override make_trait_impl_items(): ast.AssocItem[] | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_trait_impl_items(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:111 forward_to_parser_any_macro!(make_trait_items, ..)
  override make_trait_items(): ast.AssocItem[] | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_trait_items(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:112 forward_to_parser_any_macro!(make_foreign_items, ..)
  override make_foreign_items(): ast.ForeignItem[] | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_foreign_items(), noop_other, keep_selected);
  }

  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:114 forward_to_parser_any_macro!(make_ty, Box<ast::Ty>)
  override make_ty(): ast.Ty | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_ty(), noop_other, keep_selected);
  }
  // rustc-macro: compiler/rustc_builtin_macros/src/cfg_select.rs:115 forward_to_parser_any_macro!(make_pat, Box<ast::Pat>)
  override make_pat(): ast.Pat | undefined {
    return forward_to_parser_any_macro(this, (r) => r.make_pat(), noop_other, keep_selected);
  }
}

// rustc: compiler/rustc_builtin_macros/src/cfg_select.rs:26 tts_to_mac_result
function tts_to_mac_result(ecx: ExtCtxt, site_span: Span, tts: TokenStream, span: Span): MacResult {
  const r = ExpandResult.from_tts(ecx, tts, site_span, span, Ident.with_dummy_span(sym.cfg_select));
  if (r.$ === "Ready") {
    return r._0;
  }
  return unreachable("from_tts always returns Ready");
}

/**
 * `macro_rules! forward_to_parser_any_macro` (cfg_select.rs:39): the body of each generated
 * `fn $method_name(self: Box<Self>) -> Option<$ret_ty>`. `$other` / `$selected` default to
 * `|_, _, _, _| {}` / `|_, _, elements| elements` (the second macro arm).
 */
function forward_to_parser_any_macro<R>(
  self: CfgSelectResult,
  method: (r: MacResult) => R | undefined,
  other: (ecx: ExtCtxt, cfg_entry: CfgEntry, span: Span, result: R | undefined) => void,
  selected: (ecx: ExtCtxt, cfg_entry: CfgEntry, elements: R) => R,
): R | undefined {
  const { ecx, site_span, selected_tts, selected_span, cfg_entry } = self;

  for (const [cfg_entry_, tts, span] of self.other_branches.into_iter_tts()) {
    const result = method(tts_to_mac_result(ecx, site_span, tts, span));
    other(ecx, cfg_entry_, span, result);
  }

  const elements = method(tts_to_mac_result(ecx, site_span, selected_tts, selected_span));
  return elements === undefined ? undefined : selected(ecx, cfg_entry, elements);
}
function noop_other(_ecx: ExtCtxt, _cfg_entry: CfgEntry, _span: Span, _result: unknown): void {}
function keep_selected<R>(_ecx: ExtCtxt, _cfg_entry: CfgEntry, elements: R): R {
  return elements;
}

/// Construct a `#[<cfg_trace>]` attribute from a `CfgEntry`. This allows us to keep track of items
/// that were behind a `cfg_select!`, which is relevant for some diagnostics.
// rustc: compiler/rustc_builtin_macros/src/cfg_select.rs:65 mk_attr
function mk_attr(g: AttrIdGenerator, cfg_entry: CfgEntry): ast.Attribute {
  const cfg_span = CfgEntry.span(cfg_entry);
  return new ast.Attribute(
    { $: "Synthetic", _0: { $: "CfgAttrTrace", _0: cfg_entry } },
    g.mk_attr_id(),
    ast.AttrStyle.Outer,
    cfg_span,
  );
}

// rustc: compiler/rustc_builtin_macros/src/cfg_select.rs:118 expand_cfg_select
export function expand_cfg_select(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_cfg_select(ecx.new_parser_from_tts(tts), ecx.sess, ecx.ecfg.features, ecx.current_expansion.lint_node_id);
  let res: MacResult;
  if (r.$ === "Ok") {
    const branches = r._0;
    const m = branches.pop_first_match((cfg) => eval_config_entry(ecx.sess, cfg));
    if (m !== undefined) {
      const [cfg_entry, selected_tts, selected_span] = m;
      const mac = new CfgSelectResult(ecx, sp, selected_tts, selected_span, branches, cfg_entry);
      return { $: "Ready", _0: mac };
    } else {
      // Emit a compiler error when none of the predicates matched.
      const guar = ecx.dcx().emit_err(CfgSelectNoMatches_diagnostic({ span: sp }));
      res = DummyResult.any(sp, guar);
    }
  } else {
    res = DummyResult.any(sp, r._0);
  }
  return { $: "Ready", _0: res };
}
