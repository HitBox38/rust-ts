// Port of compiler/rustc_builtin_macros/src/proc_macro_harness.rs
import { ast, attr, visit } from "../rustc_ast/lib.ts";
import { path_to_string } from "../rustc_ast_pretty/pprust/mod.ts";
import { AttributeParser } from "../rustc_attr_parsing/interface.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import { ExtCtxt, type ResolverExpand } from "../rustc_expand/base.ts";
import { AstFragment, ExpansionConfig } from "../rustc_expand/expand.ts";
import type { Features } from "../rustc_feature/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { Ident, kw, sym } from "../rustc_span/symbol.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";

type NodeId = ast.NodeId;
const { Visitor } = visit;

interface ProcMacroDerive {
  id: NodeId;
  function_ident: Ident;
  span: Span;
}

interface ProcMacroDef {
  id: NodeId;
  function_ident: Ident;
  span: Span;
}

type ProcMacro = { $: "Derive"; _0: ProcMacroDerive } | { $: "Attr"; _0: ProcMacroDef } | { $: "Bang"; _0: ProcMacroDef };

// rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:49 inject
export function inject(
  krate: ast.Crate,
  sess: Session,
  features: Features,
  resolver: ResolverExpand,
  is_proc_macro_crate: boolean,
  has_proc_macro_decls: boolean,
  is_test_crate: boolean,
  dcx: DiagCtxtHandle,
): void {
  const ecfg = ExpansionConfig.default(sym.proc_macro, features);
  const cx = ExtCtxt.new(sess, ecfg, resolver, undefined);

  const collect = new CollectProcMacros([], true, dcx, sess, sess.source_map(), is_proc_macro_crate, is_test_crate);

  if (has_proc_macro_decls || is_proc_macro_crate) {
    visit.walk_crate(collect, krate);
  }
  const macros = collect.macros;

  if (!is_proc_macro_crate) {
    return;
  }

  if (is_test_crate) {
    return;
  }

  const decls = mk_decls(cx, macros);
  krate.items.push(decls);
}

class CollectProcMacros extends Visitor {
  constructor(
    public macros: ProcMacro[],
    public in_root: boolean,
    public dcx: DiagCtxtHandle,
    public session: Session,
    public source_map: SourceMap,
    public is_proc_macro_crate: boolean,
    public is_test_crate: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:90 check_not_pub_in_root
  check_not_pub_in_root(vis: ast.Visibility, sp: Span): void {
    if (this.is_proc_macro_crate && this.in_root && ast.VisibilityKind.is_pub(vis.kind)) {
      this.dcx.emit_err(diagnostics.ProcMacro_diagnostic({ span: sp }));
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:96 collect_custom_derive
  collect_custom_derive(item: ast.Item, function_ident: Ident, attr_: ast.Attribute): void {
    const parsed = AttributeParser.parse_limited_sym(this.session, [attr_], [sym.proc_macro_derive]);
    if (!(parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "ProcMacroDerive")) {
      return;
    }

    if (this.in_root && ast.VisibilityKind.is_pub(item.vis.kind)) {
      this.macros.push({ $: "Derive", _0: { id: item.id, span: item.span, function_ident } });
    } else {
      const msg = !this.in_root
        ? "functions tagged with `#[proc_macro_derive]` must currently reside in the root of the crate"
        : "functions tagged with `#[proc_macro_derive]` must be `pub`";
      this.dcx.span_err(this.source_map.guess_head_span(item.span), msg);
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:129 collect_attr_proc_macro
  collect_attr_proc_macro(item: ast.Item, function_ident: Ident): void {
    if (this.in_root && ast.VisibilityKind.is_pub(item.vis.kind)) {
      this.macros.push({ $: "Attr", _0: { id: item.id, span: item.span, function_ident } });
    } else {
      const msg = !this.in_root
        ? "functions tagged with `#[proc_macro_attribute]` must currently reside in the root of the crate"
        : "functions tagged with `#[proc_macro_attribute]` must be `pub`";
      this.dcx.span_err(this.source_map.guess_head_span(item.span), msg);
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:147 collect_bang_proc_macro
  collect_bang_proc_macro(item: ast.Item, function_ident: Ident): void {
    if (this.in_root && ast.VisibilityKind.is_pub(item.vis.kind)) {
      this.macros.push({ $: "Bang", _0: { id: item.id, span: item.span, function_ident } });
    } else {
      const msg = !this.in_root
        ? "functions tagged with `#[proc_macro]` must currently reside in the root of the crate"
        : "functions tagged with `#[proc_macro]` must be `pub`";
      this.dcx.span_err(this.source_map.guess_head_span(item.span), msg);
    }
  }

  // impl<'a> Visitor<'a> for CollectProcMacros<'a>
  // rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:167 visit_item
  override visit_item(item: ast.Item): undefined {
    if (item.kind.$ === "MacroDef") {
      if (this.is_proc_macro_crate && attr.contains_name(item.attrs, sym.macro_export)) {
        this.dcx.emit_err(diagnostics.ExportMacroRules_diagnostic({ span: this.source_map.guess_head_span(item.span) }));
      }
    }

    let found_attr: ast.Attribute | undefined = undefined;

    for (const attr_ of item.attrs) {
      if (attr_.is_proc_macro_attr()) {
        const prev_attr = found_attr;
        if (prev_attr !== undefined) {
          const prev_item = prev_attr.get_normal_item();
          const item = attr_.get_normal_item();
          const path_str = path_to_string(item.path);
          const msg =
            item.path.segments[0]!.ident.name === prev_item.path.segments[0]!.ident.name
              ? `only one \`#[${path_str}]\` attribute is allowed on any given function`
              : `\`#[${path_str}]\` and \`#[${path_to_string(prev_item.path)}]\` attributes cannot both be applied\n                            to the same function`;

          this.dcx.struct_span_err(attr_.span, msg).with_span_label(prev_attr.span, "previous attribute here").emit();

          return undefined;
        }

        found_attr = attr_;
      }
    }

    const attr_ = found_attr;
    if (attr_ === undefined) {
      this.check_not_pub_in_root(item.vis, this.source_map.guess_head_span(item.span));
      const prev_in_root = this.in_root;
      this.in_root = false;
      visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
      this.in_root = prev_in_root;
      return undefined;
    }

    // Make sure we're checking a bare function. If we're not then we're
    // just not interested any further in this item.
    let fn_ident: Ident;
    if (item.kind.$ === "Fn") {
      fn_ident = item.kind._0.ident;
    } else {
      // Error handled by general target checking logic
      return undefined;
    }

    if (this.is_test_crate) {
      return undefined;
    }

    if (!this.is_proc_macro_crate) {
      const path = attr_.get_normal_item().path;
      this.dcx.emit_err(
        diagnostics.AttributeOnlyUsableWithCrateType_diagnostic({
          span: path.span,
          path: path_to_string(attr_.get_normal_item().path),
        }),
      );
      return undefined;
    }

    // Try to locate a `#[proc_macro_derive]` attribute.
    if (attr_.has_name(sym.proc_macro_derive)) {
      this.collect_custom_derive(item, fn_ident, attr_);
    } else if (attr_.has_name(sym.proc_macro_attribute)) {
      this.collect_attr_proc_macro(item, fn_ident);
    } else if (attr_.has_name(sym.proc_macro)) {
      this.collect_bang_proc_macro(item, fn_ident);
    }

    const prev_in_root = this.in_root;
    this.in_root = false;
    visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
    this.in_root = prev_in_root;
    return undefined;
  }
}

// Creates a new module which looks like:
//
//      const _: () = {
//          extern crate proc_macro;
//
//          use proc_macro::bridge::client::ProcMacro;
//
//          #[rustc_proc_macro_decls]
//          #[used]
//          #[allow(deprecated)]
//          static DECLS: &[ProcMacro] = &[
//              ProcMacro::custom_derive($name_trait1, &[], ::$name1);
//              ProcMacro::custom_derive($name_trait2, &["attribute_name"], ::$name2);
//              // ...
//          ];
//      }
// rustc: compiler/rustc_builtin_macros/src/proc_macro_harness.rs:272 mk_decls
function mk_decls(cx: ExtCtxt, macros: readonly ProcMacro[]): ast.Item {
  const expn_id = cx.resolver.expansion_for_ast_pass(DUMMY_SP, "ProcMacroHarness", [sym.rustc_attrs, sym.proc_macro_internals], undefined);
  const span = Span.with_def_site_ctxt(DUMMY_SP, LocalExpnId.to_expn_id(expn_id));

  const proc_macro = Ident.new(sym.proc_macro, span);
  const krate = cx.item(span, [], { $: "ExternCrate", _0: undefined, _1: proc_macro });

  const bridge = Ident.new(sym.bridge, span);
  const client = Ident.new(sym.client, span);
  const client_ty = Ident.new(sym.Client, span);
  const expand1 = Ident.new(sym.expand1, span);
  const expand2 = Ident.new(sym.expand2, span);

  // We add NodeIds to 'resolver.proc_macros' in the order
  // that we generate expressions. The position of each NodeId
  // in the 'proc_macros' Vec corresponds to its position
  // in the static array that will be generated
  const decls = macros.map((m) => {
    const harness_span = span;
    let span_: Span;
    switch (m.$) {
      case "Derive":
        span_ = m._0.span;
        break;
      case "Attr":
      case "Bang":
        span_ = m._0.span;
        break;
    }
    const local_path = (cx: ExtCtxt, ident: Ident): ast.Expr => cx.expr_path(cx.path(span_, [ident]));
    const proc_macro_ty_method_path = (cx: ExtCtxt, method: Ident): ast.Expr =>
      cx.expr_path(cx.path(Span.with_ctxt(span_, Span.ctxt(harness_span)), [proc_macro, bridge, client, client_ty, method]));
    switch (m.$) {
      case "Derive": {
        const cd = m._0;
        cx.resolver.declare_proc_macro(cd.id);
        // The call needs to use `harness_span` so that the const stability checker
        // accepts it.
        return cx.expr_call(harness_span, proc_macro_ty_method_path(cx, expand1), [local_path(cx, cd.function_ident)]);
      }
      case "Attr":
      case "Bang": {
        const ca = m._0;
        cx.resolver.declare_proc_macro(ca.id);
        let ident: Ident;
        switch (m.$) {
          case "Attr":
            ident = expand2;
            break;
          case "Bang":
            ident = expand1;
            break;
          default:
            return unreachable();
        }

        // The call needs to use `harness_span` so that the const stability checker
        // accepts it.
        return cx.expr_call(harness_span, proc_macro_ty_method_path(cx, ident), [local_path(cx, ca.function_ident)]);
      }
    }
  });

  const decls_static = cx.item_static(
    span,
    [],
    Ident.new(sym._DECLS, span),
    cx.ty_ref(
      span,
      cx.ty(span, { $: "Slice", _0: cx.ty_path(cx.path(span, [proc_macro, bridge, client, client_ty])) }),
      undefined,
      "Not",
    ),
    "Not",
    cx.expr_array_ref(span, decls),
  );
  decls_static.attrs.push(
    cx.attr_word(sym.rustc_proc_macro_decls, span),
    cx.attr_word(sym.used, span),
    cx.attr_nested_word(sym.allow, sym.deprecated, span),
  );

  const block = cx.expr_block(cx.block(span, [cx.stmt_item(span, krate), cx.stmt_item(span, decls_static)]));

  const anon_constant = cx.item_const(span, Ident.new(kw.Underscore, span), cx.ty(span, { $: "Tup", _0: [] }), block);

  // Integrate the new item into existing module structures.
  const items: AstFragment = { $: "Items", _0: [anon_constant] };
  return unwrap(AstFragment.make_items(cx.monotonic_expander().fully_expand_fragment(items)).pop());
}
