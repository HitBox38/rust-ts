// Port of compiler/rustc_builtin_macros/src/standard_library_imports.rs
import { ast, attr } from "../rustc_ast/lib.ts";
import { ExtCtxt, type ResolverExpand } from "../rustc_expand/base.ts";
import { ExpansionConfig } from "../rustc_expand/expand.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { Session } from "../rustc_session/session.ts";
import { Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { AstPass, LocalExpnId } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";

// rustc: compiler/rustc_builtin_macros/src/standard_library_imports.rs:11 inject
export function inject(
  krate: ast.Crate,
  pre_configured_attrs: readonly ast.Attribute[],
  resolver: ResolverExpand,
  sess: Session,
  features: Features,
): number {
  const orig_num_items = krate.items.length;
  const edition = sess.psess.edition;

  // the first name in this list is the crate name of the crate with the prelude
  let name: Symbol;
  if (attr.contains_name(pre_configured_attrs, sym.no_core)) {
    return 0;
  } else if (attr.contains_name(pre_configured_attrs, sym.no_std)) {
    name = sym.core;
  } else {
    name = sym.std;
  }

  const expn_id = resolver.expansion_for_ast_pass(DUMMY_SP, AstPass.StdImports, [sym.prelude_import], undefined);
  const span = Span.with_def_site_ctxt(DUMMY_SP, LocalExpnId.to_expn_id(expn_id));
  const call_site = Span.with_call_site_ctxt(DUMMY_SP, LocalExpnId.to_expn_id(expn_id));

  const ecfg = ExpansionConfig.default(sym.std_lib_injection, features);
  const cx = ExtCtxt.new(sess, ecfg, resolver, undefined);

  const ident_span = Edition_discriminant[edition] >= Edition_discriminant[Edition.Edition2018] ? span : call_site;

  const item = cx.item(span, [], { $: "ExternCrate", _0: undefined, _1: Ident.new(name, ident_span) });

  const root = edition === Edition.Edition2015 ? kw.PathRoot : undefined;

  let edition_sym: Symbol;
  switch (edition) {
    case "Edition2015":
      edition_sym = sym.rust_2015;
      break;
    case "Edition2018":
      edition_sym = sym.rust_2018;
      break;
    case "Edition2021":
      edition_sym = sym.rust_2021;
      break;
    case "Edition2024":
      edition_sym = sym.rust_2024;
      break;
    case "EditionFuture":
      edition_sym = sym.rust_future;
      break;
  }
  const import_path = [...(root !== undefined ? [root] : []), name, sym.prelude, edition_sym].map((symbol) =>
    Ident.new(symbol, span),
  );

  // Inject the relevant crate's prelude.
  const use_item = cx.item(span, [cx.attr_word(sym.prelude_import, span)], {
    $: "Use",
    _0: new ast.UseTree(cx.path(span, import_path), { $: "Glob", _0: span }),
  });

  krate.items.splice(0, 0, item, use_item);
  return krate.items.length - orig_num_items;
}
