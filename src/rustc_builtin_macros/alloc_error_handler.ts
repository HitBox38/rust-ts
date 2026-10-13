// Port of compiler/rustc_builtin_macros/src/alloc_error_handler.rs
import { ALLOC_ERROR_HANDLER, global_fn_name } from "../rustc_ast/expand/allocator.ts";
import { ast, clone_Ty } from "../rustc_ast/lib.ts";
import { type Annotatable, clone_Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym } from "../rustc_span/symbol.ts";
import * as diagnostics from "./diagnostics.ts";
import { check_builtin_macro_attribute } from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/alloc_error_handler.rs:12 expand
export function expand(ecx: ExtCtxt, _span: Span, meta_item: ast.MetaItem, item_: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(ecx, meta_item, sym.alloc_error_handler);

  const orig_item = clone_Annotatable(item_);

  // Allow using `#[alloc_error_handler]` on an item statement
  // FIXME - if we get deref patterns, use them to reduce duplication here
  let item: ast.Item;
  let ident: Ident;
  let is_stmt: boolean;
  let sig_span: Span;
  if (item_.$ === "Item" && item_._0.kind.$ === "Fn") {
    const fn_kind = item_._0.kind._0;
    [item, ident, is_stmt, sig_span] = [item_._0, fn_kind.ident, false, ecx.with_def_site_ctxt(fn_kind.sig.span)];
  } else if (item_.$ === "Stmt" && item_._0.kind.$ === "Item" && item_._0.kind._0.kind.$ === "Fn") {
    const fn_kind = item_._0.kind._0.kind._0;
    [item, ident, is_stmt, sig_span] = [item_._0.kind._0, fn_kind.ident, true, ecx.with_def_site_ctxt(fn_kind.sig.span)];
  } else {
    ecx.dcx().emit_err(diagnostics.AllocErrorMustBeFn_diagnostic({ span: item_.span() }));
    return [orig_item];
  }

  // Generate a bunch of new items using the AllocFnFactory
  const span = ecx.with_def_site_ctxt(item.span);

  // Generate item statements for the allocator methods.
  const stmts = [generate_handler(ecx, ident, span, sig_span)];

  // Generate anonymous constant serving as container for the allocator methods.
  const const_ty = ecx.ty(sig_span, { $: "Tup", _0: [] });
  const const_body = ecx.expr_block(ecx.block(span, stmts));
  const const_item_ = ecx.item_const(span, Ident.new(kw.Underscore, span), const_ty, const_body);
  const const_item: Annotatable = is_stmt
    ? { $: "Stmt", _0: ecx.stmt_item(span, const_item_) }
    : { $: "Item", _0: const_item_ };

  // Return the original item and the new methods.
  return [orig_item, const_item];
}

// #[rustc_std_internal_symbol]
// unsafe fn __rust_alloc_error_handler(size: usize, align: usize) -> ! {
//     handler(core::alloc::Layout::from_size_align_unchecked(size, align))
// }
// rustc: compiler/rustc_builtin_macros/src/alloc_error_handler.rs:63 generate_handler
function generate_handler(cx: ExtCtxt, handler: Ident, span: Span, sig_span: Span): ast.Stmt {
  const usize = cx.path_ident(span, Ident.new(sym.usize, span));
  const ty_usize = cx.ty_path(usize);
  const size = Ident.new(sym.size, span);
  const align = Ident.new(sym.align, span);

  const layout_new_ = cx.std_path([sym.alloc, sym.Layout, sym.from_size_align_unchecked]);
  const layout_new = cx.expr_path(cx.path(span, layout_new_));
  const layout = cx.expr_call(span, layout_new, [cx.expr_ident(span, size), cx.expr_ident(span, align)]);

  const call = cx.expr_call_ident(sig_span, handler, [layout]);

  const never: ast.FnRetTy = { $: "Ty", _0: cx.ty(span, ast.TyKind.Never) };
  const params = [cx.param(span, size, clone_Ty(ty_usize)), cx.param(span, align, ty_usize)];
  const decl = cx.fn_decl(params, never);
  // `FnHeader { safety: Safety::Unsafe(span), ..FnHeader::default() }`
  const header = ast.FnHeader.default();
  header.safety = { $: "Unsafe", _0: span };
  const sig = new ast.FnSig(header, decl, span);

  const body = cx.block_expr(call);
  const kind: ast.ItemKind = {
    $: "Fn",
    _0: new ast.Fn(
      ast.Defaultness.Implicit,
      Ident.from_str_and_span(global_fn_name(ALLOC_ERROR_HANDLER), span),
      generics_default(),
      sig,
      undefined,
      undefined,
      body,
      undefined,
    ),
  };

  const attrs = [cx.attr_word(sym.rustc_std_internal_symbol, span)];

  const item = cx.item(span, attrs, kind);
  return cx.stmt_item(sig_span, item);
}

/** PORT: `Generics::default()` (`#[derive(Default)]` on `Generics` and `WhereClause`, ast.rs:483/491). */
function generics_default(): ast.Generics {
  return { params: [], where_clause: new ast.WhereClause(false, [], DUMMY_SP), span: DUMMY_SP };
}
